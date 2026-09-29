const MODEL_ID = "onnx-community/depth-anything-v2-small";

let depthEstimator = null;
let transformersModule = null;

async function loadEstimator(onProgress) {
	if (depthEstimator) return depthEstimator;

	transformersModule ??= await import("@huggingface/transformers");
	const { pipeline } = transformersModule;
	const preferredDevice = "gpu" in navigator ? "webgpu" : "wasm";

	onProgress?.({ stage: "model", progress: 0, device: preferredDevice });

	try {
		depthEstimator = await pipeline("depth-estimation", MODEL_ID, {
			device: preferredDevice,
			progress_callback: (event) => {
				if (event.status === "progress") {
					onProgress?.({
						stage: "model",
						progress: event.progress / 100,
						device: preferredDevice,
					});
				}
			},
		});
	} catch (error) {
		if (preferredDevice !== "webgpu") throw error;
		console.warn("WebGPU depth model failed; retrying with WASM.", error);
		onProgress?.({ stage: "fallback", progress: 0, device: "wasm" });
		depthEstimator = await pipeline("depth-estimation", MODEL_ID, {
			device: "wasm",
			progress_callback: (event) => {
				if (event.status === "progress") {
					onProgress?.({
						stage: "model",
						progress: event.progress / 100,
						device: "wasm",
					});
				}
			},
		});
	}

	return depthEstimator;
}

export async function imageToPointCloud(file, { maxSide = 512, depthScale = 1.8, onProgress } = {}) {
	if (!file?.type?.startsWith("image/")) {
		throw new Error("Choose a JPG, PNG, or WebP image.");
	}

	transformersModule ??= await import("@huggingface/transformers");
	const { RawImage } = transformersModule;
	let image = await RawImage.fromBlob(file);
	image.rgb();

	const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
	if (scale < 1) {
		image = await image.resize(
			Math.max(1, Math.round(image.width * scale)),
			Math.max(1, Math.round(image.height * scale)),
		);
	}

	const estimator = await loadEstimator(onProgress);
	onProgress?.({ stage: "inference", progress: 0, device: "local" });
	const result = await estimator(image);
	onProgress?.({ stage: "geometry", progress: 0.8, device: "local" });

	const { width, height } = result.depth;
	const depth = result.depth.data;
	const rgb = image.data;
	const count = width * height;
	const positions = new Float32Array(count * 3);
	const colors = new Float32Array(count * 3);
	const unit = 2.7 / Math.max(width, height);

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = y * width + x;
			const i3 = i * 3;
			const normalizedDepth = depth[i] / 255;

			positions[i3] = (x - (width - 1) * 0.5) * unit;
			positions[i3 + 1] = ((height - 1) * 0.5 - y) * unit;
			positions[i3 + 2] = (normalizedDepth - 0.5) * depthScale;

			colors[i3] = rgb[i3] / 255;
			colors[i3 + 1] = rgb[i3 + 1] / 255;
			colors[i3 + 2] = rgb[i3 + 2] / 255;
		}
	}

	onProgress?.({ stage: "done", progress: 1, device: "local" });
	return { positions, colors, vertexCount: count, width, height };
}

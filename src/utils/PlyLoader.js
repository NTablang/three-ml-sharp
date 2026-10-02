import * as THREE from "three";
import { GPUComputationRenderer } from "three/examples/jsm/misc/GPUComputationRenderer";
import gpgpuParticlesShader from "../shaders/gpgpu/particles.glsl";
import vertexShader from "../shaders/particles.vert";
import fragmentShader from "../shaders/particles.frag";

export default class PlyLoader {
	constructor(url, options = {}) {
		this.url = url;
		this.data = options.data ?? null;

		this.points = null;
		this.material = null;
		this.gpgpu = null;
		this.particlesVariable = null;

		this.onLoad = options.onLoad ?? null;
		this.onProgress = options.onProgress ?? null;
		this.onError = options.onError ?? null;

		this.size = options.size ?? 0.01;
		this.flowFieldInfluence = options.flowFieldInfluence ?? 0.5;
		this.flowFieldStrength = options.flowFieldStrength ?? 2.0;
		this.flowFieldFrequency = options.flowFieldFrequency ?? 0.5;
		this.returnStrength = options.returnStrength ?? 1.8;
		this.lifeSpeed = options.lifeSpeed ?? 0.32;
		this.scatter = options.scatter ?? 3.5;
		this.renderer = options.renderer ?? null;

		this.#load();
	}

	#load() {
		if (this.data) {
			queueMicrotask(() => {
				try {
					this.#build(this.data);
				} catch (error) {
					console.error("Point cloud build error:", error);
					this.onError?.(error);
				}
			});
			return;
		}

		fetch(this.url)
			.then((response) => {
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				return this.#readWithProgress(response);
			})
			.then((buffer) => this.#build(this.#parse(buffer)))
			.catch((error) => {
				console.error("PLY load error:", error);
				this.onError?.(error);
			});
	}

	#build({ positions, colors, vertexCount = positions.length / 3 }) {
		this.#setupGPGPU(positions, vertexCount);
		this.#setupParticles(positions, colors, vertexCount);
		this.onLoad?.(this.points);
	}

	#parse(buffer) {
		const headerEnd = this.#findHeaderEnd(buffer);
		const headerText = new TextDecoder().decode(
			new Uint8Array(buffer, 0, headerEnd),
		);
		const dataStart = headerEnd + "end_header\n".length;

		const { vertexCount, properties, stride } = this.#parseHeader(headerText);

		const dataView = new DataView(buffer, dataStart);

		const positions = new Float32Array(vertexCount * 3);
		const colors = new Float32Array(vertexCount * 3);

		const xOff = properties.get("x");
		const yOff = properties.get("y");
		const zOff = properties.get("z");
		const dc0Off = properties.get("f_dc_0");
		const dc1Off = properties.get("f_dc_1");
		const dc2Off = properties.get("f_dc_2");

		const hasSHColors =
			dc0Off !== undefined && dc1Off !== undefined && dc2Off !== undefined;
		const SH_C0 = 0.28209479177387814;

		for (let i = 0; i < vertexCount; i++) {
			const base = i * stride;

			positions[i * 3] = dataView.getFloat32(base + xOff, true);
			positions[i * 3 + 1] = dataView.getFloat32(base + yOff, true);
			positions[i * 3 + 2] = dataView.getFloat32(base + zOff, true);

			if (hasSHColors) {
				const r = dataView.getFloat32(base + dc0Off, true);
				const g = dataView.getFloat32(base + dc1Off, true);
				const b = dataView.getFloat32(base + dc2Off, true);

				colors[i * 3] = Math.max(0, Math.min(1, 0.5 + SH_C0 * r));
				colors[i * 3 + 1] = Math.max(0, Math.min(1, 0.5 + SH_C0 * g));
				colors[i * 3 + 2] = Math.max(0, Math.min(1, 0.5 + SH_C0 * b));
			} else {
				colors[i * 3] = 1.0;
				colors[i * 3 + 1] = 1.0;
				colors[i * 3 + 2] = 1.0;
			}
		}

		return { positions, colors, vertexCount };
	}

	#setupGPGPU(positions, vertexCount) {
		// compute texture size (width x height >= vertexCount)
		const size = Math.ceil(Math.sqrt(vertexCount));
		this.gpgpuSize = size;

		this.gpgpu = new GPUComputationRenderer(size, size, this.renderer);

		// base texture holds the original positions
		const baseTexture = this.gpgpu.createTexture();
		// particles texture holds the current state
		const particlesTexture = this.gpgpu.createTexture();

		for (let i = 0; i < size * size; i++) {
			const i3 = i * 3;
			const i4 = i * 4;

			if (i < vertexCount) {
				baseTexture.image.data[i4 + 0] = positions[i3 + 0];
				baseTexture.image.data[i4 + 1] = positions[i3 + 1];
				baseTexture.image.data[i4 + 2] = positions[i3 + 2];
				baseTexture.image.data[i4 + 3] = Math.random();

				particlesTexture.image.data[i4 + 0] = positions[i3 + 0];
				particlesTexture.image.data[i4 + 1] = positions[i3 + 1];
				particlesTexture.image.data[i4 + 2] = positions[i3 + 2];
				particlesTexture.image.data[i4 + 3] = Math.random();
			}
		}

		this.particlesVariable = this.gpgpu.addVariable(
			"uParticles",
			gpgpuParticlesShader,
			particlesTexture,
		);

		this.gpgpu.setVariableDependencies(this.particlesVariable, [
			this.particlesVariable,
		]);

		// uniforms
		this.particlesVariable.material.uniforms.uTime = { value: 0 };
		this.particlesVariable.material.uniforms.uDeltaTime = { value: 0 };
		this.particlesVariable.material.uniforms.uBase = { value: baseTexture };
		this.particlesVariable.material.uniforms.uFlowFieldInfluence = {
			value: this.flowFieldInfluence,
		};
		this.particlesVariable.material.uniforms.uFlowFieldStrength = {
			value: this.flowFieldStrength,
		};
		this.particlesVariable.material.uniforms.uFlowFieldFrequency = {
			value: this.flowFieldFrequency,
		};
		this.particlesVariable.material.uniforms.uReturnStrength = {
			value: this.returnStrength,
		};
		this.particlesVariable.material.uniforms.uLifeSpeed = {
			value: this.lifeSpeed,
		};
		this.particlesVariable.material.uniforms.uAudioBands = {
			value: new THREE.Vector3(),
		};
		this.particlesVariable.material.uniforms.uAttractor = {
			value: new THREE.Vector3(),
		};
		this.particlesVariable.material.uniforms.uAttractorStrength = {
			value: 0,
		};
		this.particlesVariable.material.uniforms.uAttractorRadius = {
			value: 1.4,
		};

		this.gpgpu.init();
	}

	#setupParticles(positions, colors, vertexCount) {
		const size = this.gpgpuSize;

		// UV coordinates to sample the GPGPU texture
		const particlesUv = new Float32Array(vertexCount * 2);
		const sizesArray = new Float32Array(vertexCount);
		const randomArray = new Float32Array(vertexCount);

		for (let i = 0; i < vertexCount; i++) {
			const y = Math.floor(i / size);
			const x = i % size;

			particlesUv[i * 2 + 0] = (x + 0.5) / size;
			particlesUv[i * 2 + 1] = (y + 0.5) / size;

			sizesArray[i] = 0.35 + Math.random() * 0.65;
			randomArray[i] = Math.random();
		}

		const geometry = new THREE.BufferGeometry();
		geometry.setDrawRange(0, vertexCount);
		geometry.setAttribute(
			"aParticlesUv",
			new THREE.BufferAttribute(particlesUv, 2),
		);
		geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
		geometry.setAttribute("aSize", new THREE.BufferAttribute(sizesArray, 1));
		geometry.setAttribute("aRandom", new THREE.BufferAttribute(randomArray, 1));
		geometry.setAttribute(
			"aBasePosition",
			new THREE.BufferAttribute(positions, 3),
		);

		this.material = new THREE.ShaderMaterial({
			vertexShader,
			fragmentShader,
			uniforms: {
				...THREE.UniformsLib.fog,
				uSize: { value: this.size },
				uResolution: {
					value: new THREE.Vector2(
						window.innerWidth * window.devicePixelRatio,
						window.innerHeight * window.devicePixelRatio,
					),
				},
				uParticlesTexture: {
					value: this.gpgpu.getCurrentRenderTarget(this.particlesVariable)
						.texture,
				},
				uReveal: { value: 1 },
				uScatter: { value: this.scatter },
				uAudioBands: { value: new THREE.Vector3() },
			},
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			side: THREE.DoubleSide,
			fog: true,
		});

		this.points = new THREE.Points(geometry, this.material);
		this.points.frustumCulled = false;
	}

	setAudioBands(bass, mid, high) {
		this.particlesVariable?.material.uniforms.uAudioBands.value.set(
			bass,
			mid,
			high,
		);
		this.material?.uniforms.uAudioBands.value.set(bass, mid, high);
	}

	setAttractor(x, y, z, strength = 0) {
		if (!this.particlesVariable) return;
		const uniforms = this.particlesVariable.material.uniforms;
		uniforms.uAttractor.value.set(x, y, z);
		uniforms.uAttractorStrength.value = strength;
	}

	update(delta, elapsed) {
		if (!this.gpgpu || !this.particlesVariable) return;

		this.particlesVariable.material.uniforms.uTime.value = elapsed;
		this.particlesVariable.material.uniforms.uDeltaTime.value = delta;

		this.gpgpu.compute();

		this.material.uniforms.uParticlesTexture.value =
			this.gpgpu.getCurrentRenderTarget(this.particlesVariable).texture;
	}

	onResize(width, height) {
		if (!this.material) return;
		this.material.uniforms.uResolution.value.set(
			width * window.devicePixelRatio,
			height * window.devicePixelRatio,
		);
	}

	dispose() {
		this.points?.geometry?.dispose();
		this.material?.dispose();
		this.gpgpu?.dispose();
	}

	async #readWithProgress(response) {
		let body = response.body;
		const contentLength = parseInt(response.headers.get("Content-Length") || "0");

		if (this.url.endsWith(".gz")) {
			body = body.pipeThrough(new DecompressionStream("gzip"));
		}

		if (!contentLength || !this.onProgress) {
			return new Response(body).arrayBuffer();
		}

		const reader = body.getReader();
		const chunks = [];
		let received = 0;

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
			received += value.length;
			this.onProgress(Math.min(received / contentLength, 1));
		}

		const result = new Uint8Array(received);
		let offset = 0;
		for (const chunk of chunks) {
			result.set(chunk, offset);
			offset += chunk.length;
		}
		return result.buffer;
	}

	#findHeaderEnd(buffer) {
		const bytes = new Uint8Array(buffer);
		const target = "end_header\n";
		for (let i = 0; i < Math.min(bytes.length, 4096); i++) {
			let match = true;
			for (let j = 0; j < target.length; j++) {
				if (bytes[i + j] !== target.charCodeAt(j)) {
					match = false;
					break;
				}
			}
			if (match) return i;
		}
		throw new Error("Could not find PLY header end");
	}

	#parseHeader(headerText) {
		const lines = headerText.split("\n");
		let vertexCount = 0;
		const properties = new Map();
		let offset = 0;
		let inVertexElement = false;

		const typeSizes = {
			float: 4,
			double: 8,
			int: 4,
			uint: 4,
			short: 2,
			ushort: 2,
			char: 1,
			uchar: 1,
		};

		for (const line of lines) {
			const parts = line.trim().split(/\s+/);

			if (parts[0] === "element") {
				if (parts[1] === "vertex") {
					vertexCount = parseInt(parts[2]);
					inVertexElement = true;
				} else {
					inVertexElement = false;
				}
			}

			if (parts[0] === "property" && inVertexElement) {
				const type = parts[1];
				const name = parts[2];
				const size = typeSizes[type] ?? 4;
				properties.set(name, offset);
				offset += size;
			}
		}

		return { vertexCount, properties, stride: offset };
	}
}

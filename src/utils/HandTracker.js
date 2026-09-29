import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

const MODEL_URL =
	"https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const WASM_URL =
	"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";

export default class HandTracker {
	constructor(video, onUpdate) {
		this.video = video;
		this.onUpdate = onUpdate;
		this.landmarker = null;
		this.stream = null;
		this.running = false;
		this.lastVideoTime = -1;
		this.raf = 0;
	}

	async start() {
		if (this.running) return;

		const vision = await FilesetResolver.forVisionTasks(WASM_URL);

		try {
			this.landmarker = await HandLandmarker.createFromOptions(vision, {
				baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
				runningMode: "VIDEO",
				numHands: 1,
				minHandDetectionConfidence: 0.55,
				minTrackingConfidence: 0.5,
			});
		} catch (error) {
			console.warn("GPU hand tracking failed; retrying on CPU.", error);
			this.landmarker = await HandLandmarker.createFromOptions(vision, {
				baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" },
				runningMode: "VIDEO",
				numHands: 1,
			});
		}

		this.stream = await navigator.mediaDevices.getUserMedia({
			video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
			audio: false,
		});
		this.video.srcObject = this.stream;
		this.video.hidden = false;
		await this.video.play();
		this.running = true;
		this.#tick();
	}

	stop() {
		this.running = false;
		cancelAnimationFrame(this.raf);
		this.stream?.getTracks().forEach((track) => track.stop());
		this.stream = null;
		this.video.srcObject = null;
		this.video.hidden = true;
		this.onUpdate?.({ active: false, strength: 0 });
	}

	#tick = () => {
		if (!this.running) return;

		if (this.video.currentTime !== this.lastVideoTime) {
			this.lastVideoTime = this.video.currentTime;
			const result = this.landmarker.detectForVideo(this.video, performance.now());
			const hand = result.landmarks?.[0];

			if (hand) {
				const thumb = hand[4];
				const index = hand[8];
				const palm = hand[9];
				const pinch = Math.hypot(thumb.x - index.x, thumb.y - index.y);
				const strength = Math.max(0, Math.min(1, (0.12 - pinch) / 0.08));
				this.onUpdate?.({
					active: true,
					x: 1 - palm.x,
					y: palm.y,
					strength,
					pinching: strength > 0.15,
				});
			} else {
				this.onUpdate?.({ active: false, strength: 0 });
			}
		}

		this.raf = requestAnimationFrame(this.#tick);
	};
}

import * as THREE from "three";
import GUI from "lil-gui";
import WebGLContext from "../core/WebGLContext";
import PlyLoader from "../utils/PlyLoader";
import { CameraRig } from "../utils/CameraRig";
import { imageToPointCloud } from "../utils/ImageDepthProcessor";
import AudioReactive from "../utils/AudioReactive";

const PRESETS = {
	dream: { influence: 0.48, strength: 0.7, frequency: 0.34, returnStrength: 2.4, lifeSpeed: 0.18, size: 0.01, scatter: 3.6 },
	storm: { influence: 0.76, strength: 3.8, frequency: 1.15, returnStrength: 0.75, lifeSpeed: 0.8, size: 0.027, scatter: 5.2 },
	still: { influence: 0.2, strength: 0.06, frequency: 0.2, returnStrength: 5.5, lifeSpeed: 0.08, size: 0.035, scatter: 2.7 },
};

const DEFAULT_ROTATION = {
	x: THREE.MathUtils.degToRad(56),
	y: THREE.MathUtils.degToRad(-147),
	z: THREE.MathUtils.degToRad(25),
};

export default class Scene {
	constructor() {
		this.context = null;
		this.camera = null;
		this.cameraRig = null;
		this.width = 0;
		this.height = 0;
		this.aspectRatio = 0;
		this.scene = null;
		this.plyLoader = null;
		this.paused = false;
		this.currentPreset = "dream";
		this.revealAnimation = null;
		this.handTracker = null;
		this.handEnabled = false;
		this.dragDepth = 0;
		this.toastTimer = 0;
		this.ui = {};
		this.#init();
	}

	async #init() {
		this.#setContext();
		this.#setupScene();
		this.#setupCamera();
		this.#setupCameraRig();
		this.#bindInterface();
		await this.#loadDefaultMemory();
	}

	#setContext() {
		this.context = new WebGLContext();
	}

	#setupScene() {
		this.scene = new THREE.Scene();
		this.scene.background = new THREE.Color(0x050508);
		this.scene.fog = new THREE.Fog(0x050508, 8, 18);
	}

	#setupCamera() {
		this.#calculateAspectRatio();
		this.camera = new THREE.PerspectiveCamera(45, this.aspectRatio, 0.01, 1000);
		this.camera.position.z = 3;
	}

	#setupCameraRig() {
		this.cameraRig = new CameraRig(this.camera, {
			target: new THREE.Vector3(0, 0, 0),
			xLimit: [-1.4, 1.4],
			yLimit: [-0.8, 0.8],
			damping: 2.4,
		});
	}

	#bindInterface() {
		const byId = (id) => document.getElementById(id);
		this.ui = {
			photoInput: byId("photo-input"),
			audioInput: byId("audio-input"),
			uploadHero: byId("upload-hero"),
			uploadButton: byId("upload-btn"),
			audioButton: byId("audio-btn"),
			handButton: byId("hand-btn"),
			reconstructButton: byId("reconstruct-btn"),
			settingsButton: byId("settings-btn"),
			controlsToggle: byId("controls-toggle"),
			controlShell: document.querySelector(".control-shell"),
			controlPanel: byId("memory-controls"),
			audioPlayer: byId("audio-player"),
			audioMeter: byId("audio-meter"),
			handPreview: byId("hand-preview"),
			handVideo: byId("hand-video"),
			handCursor: byId("hand-cursor"),
			dropZone: byId("drop-zone"),
			loader: byId("loader"),
			loaderTitle: byId("loader-title"),
			loaderDetail: byId("loader-detail"),
			loaderBar: byId("loader-bar"),
			toast: byId("toast"),
		};

		const setControlsAvailable = (available) => {
			this.ui.controlPanel.inert = !available;
			this.ui.controlPanel.setAttribute("aria-hidden", String(!available));
			this.ui.controlsToggle.setAttribute("aria-expanded", String(available));
			this.ui.controlsToggle.setAttribute("aria-label", `${available ? "Close" : "Open"} memory controls`);
		};

		this.ui.controlShell.addEventListener("mouseenter", () => {
			if (!this.ui.controlShell.classList.contains("suppress-hover")) setControlsAvailable(true);
		});
		this.ui.controlShell.addEventListener("mouseleave", () => {
			this.ui.controlShell.classList.remove("suppress-hover");
			setControlsAvailable(this.ui.controlShell.classList.contains("is-pinned"));
		});
		this.ui.controlsToggle.addEventListener("click", () => {
			const wasPinned = this.ui.controlShell.classList.contains("is-pinned");
			this.ui.controlShell.classList.toggle("is-pinned", !wasPinned);
			this.ui.controlShell.classList.toggle("suppress-hover", wasPinned);
			setControlsAvailable(!wasPinned);
		});

		const openPhotoPicker = () => this.ui.photoInput.click();
		this.ui.uploadHero.addEventListener("click", openPhotoPicker);
		this.ui.uploadButton.addEventListener("click", openPhotoPicker);
		this.ui.photoInput.addEventListener("change", () => {
			const [file] = this.ui.photoInput.files;
			if (file) this.#handleImage(file);
			this.ui.photoInput.value = "";
		});

		this.ui.audioButton.addEventListener("click", () => this.ui.audioInput.click());
		this.ui.audioInput.addEventListener("change", () => {
			const [file] = this.ui.audioInput.files;
			if (file) this.#handleAudio(file);
			this.ui.audioInput.value = "";
		});

		this.ui.handButton.addEventListener("click", () => this.#toggleHandControl());
		this.ui.reconstructButton.addEventListener("click", () => this.reconstruct());
		this.ui.settingsButton.addEventListener("click", () => {
			this.gui?.domElement.classList.toggle("is-visible");
			this.ui.settingsButton.classList.toggle("active");
		});

		document.querySelectorAll("[data-preset]").forEach((button) => {
			button.addEventListener("click", () => this.#applyPreset(button.dataset.preset));
		});

		window.addEventListener("dragenter", (event) => {
			event.preventDefault();
			this.dragDepth += 1;
			this.ui.dropZone.classList.add("active");
		});
		window.addEventListener("dragover", (event) => event.preventDefault());
		window.addEventListener("dragleave", (event) => {
			event.preventDefault();
			this.dragDepth = Math.max(0, this.dragDepth - 1);
			if (!this.dragDepth) this.ui.dropZone.classList.remove("active");
		});
		window.addEventListener("drop", (event) => {
			event.preventDefault();
			this.dragDepth = 0;
			this.ui.dropZone.classList.remove("active");
			const file = [...event.dataTransfer.files].find((item) => item.type.startsWith("image/"));
			if (file) this.#handleImage(file);
			else this.#showToast("Drop a JPG, PNG, or WebP image.", true);
		});

		this.audioReactive = new AudioReactive(this.ui.audioPlayer);
	}

	async #loadDefaultMemory() {
		this.#setLoader(true, "Opening memory", "Preparing the particle field…", 0.08);
		try {
			await this.#replacePointField({
				url: `${import.meta.env.BASE_URL}photo.min.ply`,
				rotation: DEFAULT_ROTATION,
			});
			this.#setLoader(false);
		} catch (error) {
			console.error(error);
			this.#setLoader(false);
			this.#showToast("The sample memory could not be opened. Choose your own photograph.", true);
		}
	}

	async #handleImage(file) {
		this.#setLoader(true, "Reading depth", "Loading the local vision model…", 0.04);
		let furthestProgress = 0.04;

		try {
			const data = await imageToPointCloud(file, {
				maxSide: 512,
				depthScale: 1.8,
				onProgress: ({ stage, progress, device }) => {
					const messages = {
						model: `Loading Depth Anything on ${device.toUpperCase()}…`,
						fallback: "Switching to compatibility mode…",
						inference: "Estimating the space inside your photograph…",
						geometry: "Building the particle memory…",
						done: "Opening the portal…",
					};
					const stageFloor = { model: 0.05, fallback: 0.1, inference: 0.65, geometry: 0.84, done: 0.96 }[stage] ?? 0.05;
					furthestProgress = Math.max(furthestProgress, stageFloor + progress * (stage === "model" ? 0.45 : 0.1));
					this.#setLoader(true, "Reading depth", messages[stage], Math.min(furthestProgress, 0.98));
				},
			});

			await this.#replacePointField({ data });
			document.body.classList.add("memory-loaded");
			this.#setLoader(false);
			this.#showToast("Your memory is alive. Add sound or pinch it with your hand.");
		} catch (error) {
			console.error(error);
			this.#setLoader(false);
			this.#showToast(error.message || "This photograph could not be processed.", true);
		}
	}

	async #handleAudio(file) {
		try {
			await this.audioReactive.load(file);
			this.ui.audioButton.classList.add("active");
			this.ui.audioMeter.hidden = false;
			this.#showToast(`Listening to ${file.name}`);
		} catch (error) {
			console.error(error);
			this.#showToast(error.message || "The soundtrack could not be opened.", true);
		}
	}

	async #toggleHandControl() {
		if (this.handEnabled) {
			this.handTracker?.stop();
			this.handEnabled = false;
			this.ui.handButton.classList.remove("active");
			this.ui.handPreview.hidden = true;
			this.ui.handCursor.hidden = true;
			return;
		}

		if (!navigator.mediaDevices?.getUserMedia) {
			this.#showToast("Camera hand control is not supported in this browser.", true);
			return;
		}

		this.ui.handButton.classList.add("active");
		this.#showToast("Starting private, on-device hand tracking…");
		try {
			if (!this.handTracker) {
				const { default: HandTracker } = await import("../utils/HandTracker");
				this.handTracker = new HandTracker(this.ui.handVideo, (state) => this.#onHandUpdate(state));
			}
			await this.handTracker.start();
			this.handEnabled = true;
			this.ui.handPreview.hidden = false;
			this.#showToast("Pinch your thumb and index finger to pull the particles.");
		} catch (error) {
			console.error(error);
			this.ui.handButton.classList.remove("active");
			this.ui.handPreview.hidden = true;
			this.#showToast("Hand control needs camera access and an internet connection on first use.", true);
		}
	}

	#onHandUpdate(state) {
		if (!state.active) {
			this.ui.handCursor.hidden = true;
			this.plyLoader?.setAttractor(0, 0, 0, 0);
			return;
		}

		const x = (state.x - 0.5) * 3;
		const y = (0.5 - state.y) * 2.2;
		this.plyLoader?.setAttractor(x, y, 0, state.strength * 7.5);
		this.ui.handCursor.hidden = false;
		this.ui.handCursor.style.transform = `translate(${state.x * window.innerWidth}px, ${state.y * window.innerHeight}px)`;
		this.ui.handCursor.classList.toggle("pinching", state.pinching);
	}

	#replacePointField({ url = null, data = null, rotation = { x: 0, y: 0, z: 0 } }) {
		return new Promise((resolve, reject) => {
			if (this.plyLoader?.points) this.scene.remove(this.plyLoader.points);
			this.plyLoader?.dispose();
			this.gui?.destroy();
			this.gui = null;

			this.plyLoader = new PlyLoader(url, {
				data,
				renderer: this.context.renderer,
				size: PRESETS[this.currentPreset].size,
				flowFieldInfluence: PRESETS[this.currentPreset].influence,
				flowFieldStrength: PRESETS[this.currentPreset].strength,
				flowFieldFrequency: PRESETS[this.currentPreset].frequency,
				returnStrength: PRESETS[this.currentPreset].returnStrength,
				lifeSpeed: PRESETS[this.currentPreset].lifeSpeed,
				scatter: PRESETS[this.currentPreset].scatter,
				onProgress: (progress) => {
					this.#setLoader(true, "Opening memory", "Loading the particle field…", progress * 0.9);
				},
				onLoad: (points) => {
					points.rotation.set(rotation.x, rotation.y, rotation.z);
					this.scene.add(points);
					this.#setupGui();
					this.#applyPreset(this.currentPreset);
					this.reconstruct();
					resolve(points);
				},
				onError: reject,
			});
		});
	}

	#applyPreset(name) {
		const preset = PRESETS[name];
		if (!preset || !this.plyLoader?.particlesVariable) return;
		this.currentPreset = name;
		const particleUniforms = this.plyLoader.particlesVariable.material.uniforms;
		particleUniforms.uFlowFieldInfluence.value = preset.influence;
		particleUniforms.uFlowFieldStrength.value = preset.strength;
		particleUniforms.uFlowFieldFrequency.value = preset.frequency;
		particleUniforms.uReturnStrength.value = preset.returnStrength;
		particleUniforms.uLifeSpeed.value = preset.lifeSpeed;
		this.plyLoader.material.uniforms.uSize.value = preset.size;
		this.plyLoader.material.uniforms.uScatter.value = preset.scatter;
		document.querySelectorAll("[data-preset]").forEach((button) => button.classList.toggle("active", button.dataset.preset === name));
		this.gui?.controllersRecursive().forEach((controller) => controller.updateDisplay());
	}

	reconstruct() {
		if (!this.plyLoader?.material) return;
		this.revealAnimation = { start: performance.now(), duration: 2300 };
		this.plyLoader.material.uniforms.uReveal.value = 0;
	}

	#setupGui() {
		const gui = new GUI({ title: "Fine tune" });
		gui.domElement.classList.add("tuning-panel");
		const particleUniforms = this.plyLoader.particlesVariable.material.uniforms;
		const materialUniforms = this.plyLoader.material.uniforms;
		const points = this.plyLoader.points;

		const particles = gui.addFolder("Particles");
		particles.add(materialUniforms.uSize, "value", 0.004, 0.12, 0.001).name("size");
		particles.add(this, "paused").name("pause");
		particles.add(materialUniforms.uScatter, "value", 0, 10, 0.1).name("reveal spread");

		const motion = gui.addFolder("Motion");
		motion.add(particleUniforms.uFlowFieldInfluence, "value", 0, 1, 0.01).name("coverage");
		motion.add(particleUniforms.uFlowFieldStrength, "value", 0, 8, 0.01).name("turbulence");
		motion.add(particleUniforms.uFlowFieldFrequency, "value", 0, 2, 0.01).name("frequency");
		motion.add(particleUniforms.uReturnStrength, "value", 0, 8, 0.05).name("memory pull");
		motion.add(particleUniforms.uLifeSpeed, "value", 0.02, 1.5, 0.01).name("renewal");
		motion.add(particleUniforms.uAttractorRadius, "value", 0.2, 4, 0.05).name("hand radius");

		const rotation = gui.addFolder("Rotation");
		const angles = {
			x: THREE.MathUtils.radToDeg(points.rotation.x),
			y: THREE.MathUtils.radToDeg(points.rotation.y),
			z: THREE.MathUtils.radToDeg(points.rotation.z),
		};
		rotation.add(angles, "x", -180, 180, 1).onChange((value) => (points.rotation.x = THREE.MathUtils.degToRad(value)));
		rotation.add(angles, "y", -180, 180, 1).onChange((value) => (points.rotation.y = THREE.MathUtils.degToRad(value)));
		rotation.add(angles, "z", -180, 180, 1).onChange((value) => (points.rotation.z = THREE.MathUtils.degToRad(value)));

		const camera = gui.addFolder("Camera");
		camera.add(this.camera, "fov", 20, 100, 1).onChange(() => this.camera.updateProjectionMatrix());
		camera.add(this.cameraRig, "damping", 0.2, 8, 0.1).name("parallax damping");

		const look = gui.addFolder("Look");
		look.add(this.scene.fog, "near", 1, 30, 0.1).name("fog near");
		look.add(this.scene.fog, "far", 2, 50, 0.1).name("fog far");
		const colors = { background: `#${this.scene.background.getHexString()}` };
		look.addColor(colors, "background").onChange((color) => {
			this.scene.background.set(color);
			this.scene.fog.color.set(color);
		});

		this.gui = gui;
	}

	#setLoader(visible, title = "Opening memory", detail = "", progress = 0) {
		this.ui.loader.classList.toggle("hidden", !visible);
		if (title) this.ui.loaderTitle.textContent = title;
		if (detail) this.ui.loaderDetail.textContent = detail;
		this.ui.loaderBar.style.width = `${Math.max(3, Math.min(100, progress * 100))}%`;
	}

	#showToast(message, isError = false) {
		clearTimeout(this.toastTimer);
		this.ui.toast.textContent = message;
		this.ui.toast.classList.toggle("error", isError);
		this.ui.toast.classList.add("visible");
		this.toastTimer = setTimeout(() => this.ui.toast.classList.remove("visible"), 4200);
	}

	#calculateAspectRatio() {
		const { width, height } = this.context.getFullScreenDimensions();
		this.width = width;
		this.height = height;
		this.aspectRatio = this.width / this.height;
	}

	animate(delta, elapsed) {
		this.cameraRig?.update(delta);
		const bands = this.audioReactive?.getBands() ?? { bass: 0, mid: 0, high: 0 };
		this.plyLoader?.setAudioBands(bands.bass, bands.mid, bands.high);

		if (this.ui.audioMeter && !this.ui.audioMeter.hidden) {
			const values = [bands.bass, bands.mid, bands.high, bands.mid, bands.bass];
			this.ui.audioMeter.querySelectorAll("i").forEach((bar, index) => {
				bar.style.height = `${18 + values[index] * 82}%`;
			});
		}

		if (this.revealAnimation && this.plyLoader?.material) {
			const raw = Math.min(1, (performance.now() - this.revealAnimation.start) / this.revealAnimation.duration);
			const eased = 1 - Math.pow(1 - raw, 3);
			this.plyLoader.material.uniforms.uReveal.value = eased;
			if (raw >= 1) this.revealAnimation = null;
		}

		if (!this.paused) this.plyLoader?.update(delta, elapsed);
	}

	onResize(width, height) {
		this.width = width;
		this.height = height;
		this.aspectRatio = width / height;
		this.camera.aspect = this.aspectRatio;
		this.camera.updateProjectionMatrix();
		this.plyLoader?.onResize(width, height);
	}
}

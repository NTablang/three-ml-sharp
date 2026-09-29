export default class AudioReactive {
	constructor(audioElement) {
		this.audio = audioElement;
		this.context = null;
		this.analyser = null;
		this.source = null;
		this.frequencyData = null;
		this.objectUrl = null;
		this.smoothed = { bass: 0, mid: 0, high: 0 };
	}

	async load(file) {
		if (!file?.type?.startsWith("audio/")) {
			throw new Error("Choose an audio file.");
		}

		this.objectUrl && URL.revokeObjectURL(this.objectUrl);
		this.objectUrl = URL.createObjectURL(file);
		this.audio.src = this.objectUrl;
		this.audio.hidden = false;

		const AudioContextClass = window.AudioContext || window.webkitAudioContext;
		if (!AudioContextClass) throw new Error("Web Audio is not supported in this browser.");
		this.context ??= new AudioContextClass();
		this.analyser ??= this.context.createAnalyser();
		this.analyser.fftSize = 1024;
		this.analyser.smoothingTimeConstant = 0.82;
		this.frequencyData ??= new Uint8Array(this.analyser.frequencyBinCount);

		if (!this.source) {
			this.source = this.context.createMediaElementSource(this.audio);
			this.source.connect(this.analyser);
			this.analyser.connect(this.context.destination);
		}

		await this.context.resume();
		await this.audio.play();
	}

	getBands() {
		if (!this.analyser || this.audio.paused) {
			this.#smoothTowards({ bass: 0, mid: 0, high: 0 });
			return this.smoothed;
		}

		this.analyser.getByteFrequencyData(this.frequencyData);
		const nyquist = this.context.sampleRate / 2;
		const bass = this.#averageBand(35, 180, nyquist);
		const mid = this.#averageBand(180, 2200, nyquist);
		const high = this.#averageBand(2200, 10000, nyquist);
		this.#smoothTowards({ bass, mid, high });
		return this.smoothed;
	}

	#averageBand(lowHz, highHz, nyquist) {
		const start = Math.max(0, Math.floor((lowHz / nyquist) * this.frequencyData.length));
		const end = Math.min(this.frequencyData.length, Math.ceil((highHz / nyquist) * this.frequencyData.length));
		let sum = 0;
		for (let i = start; i < end; i++) sum += this.frequencyData[i];
		return end > start ? sum / (end - start) / 255 : 0;
	}

	#smoothTowards(next) {
		for (const band of ["bass", "mid", "high"]) {
			const speed = next[band] > this.smoothed[band] ? 0.28 : 0.08;
			this.smoothed[band] += (next[band] - this.smoothed[band]) * speed;
		}
	}
}

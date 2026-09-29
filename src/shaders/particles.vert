uniform vec2 uResolution;
uniform float uSize;
uniform sampler2D uParticlesTexture;
uniform float uReveal;
uniform float uScatter;
uniform vec3 uAudioBands;

attribute vec2 aParticlesUv;
attribute vec3 aColor;
attribute float aSize;
attribute float aRandom;
attribute vec3 aBasePosition;

varying vec3 vColor;
varying float vFogDepth;
varying float vAlpha;

void main() {
  vec4 particle = texture(uParticlesTexture, aParticlesUv);
	float reveal = smoothstep(aRandom - 0.16, aRandom + 0.08, uReveal);
	vec3 scatterDirection = normalize(vec3(
		sin(aRandom * 91.7 + aBasePosition.y * 4.0),
		cos(aRandom * 73.1 + aBasePosition.x * 5.0),
		sin(aRandom * 51.3 + aBasePosition.z * 6.0)
	));
	particle.xyz += scatterDirection * (1.0 - reveal) * uScatter;

  // Final position
  vec4 modelPosition = modelMatrix * vec4(particle.xyz, 1.0);
  vec4 viewPosition = viewMatrix * modelPosition;
  vec4 projectedPosition = projectionMatrix * viewPosition;
  gl_Position = projectedPosition;

  // Point size
  float sizeIn = smoothstep(0.0, 0.6, particle.a);
  float sizeOut = 1.0 - smoothstep(0.6, 1.0, particle.a);
  float size = min(sizeIn, sizeOut);

	gl_PointSize = size * aSize * uSize * uResolution.y;
	gl_PointSize *= reveal * (1.0 + uAudioBands.z * 1.6);
  gl_PointSize *= (1.0 / - viewPosition.z);

  // Varyings
  vColor = aColor;
  vFogDepth = -viewPosition.z;
	vAlpha = reveal;
}

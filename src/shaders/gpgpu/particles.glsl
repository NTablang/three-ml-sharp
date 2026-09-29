uniform float uTime;
uniform float uDeltaTime;
uniform sampler2D uBase;
uniform float uFlowFieldInfluence;
uniform float uFlowFieldStrength;
uniform float uFlowFieldFrequency;
uniform float uReturnStrength;
uniform float uLifeSpeed;
uniform vec3 uAudioBands;
uniform vec3 uAttractor;
uniform float uAttractorStrength;
uniform float uAttractorRadius;

#include ../includes/simplexNoise4d.glsl

void main() {
  float time = uTime * 0.2;
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 particle = texture(uParticles, uv);
  vec4 base = texture(uBase, uv);

  // Dead
  if (particle.a >= 1.0) {
    particle.a = mod(particle.a, 1.0);
    particle.xyz = base.xyz;
  }

  // Alive
  else {
	// A soft spring keeps the image legible even while it moves.
	particle.xyz += (base.xyz - particle.xyz) * min(1.0, uReturnStrength * uDeltaTime);

    // Strength
    float strength = simplexNoise4d(vec4(base.xyz * 0.7, time + 1.0));
    float influence = (uFlowFieldInfluence - 0.5) * (- 2.0);
    strength = smoothstep(influence, 1.0, strength);

    // Flow field
    vec3 flowField = vec3(
      simplexNoise4d(vec4(particle.xyz * uFlowFieldFrequency + 0.0, time)),
      simplexNoise4d(vec4(particle.xyz * uFlowFieldFrequency + 1.0, time)),
      simplexNoise4d(vec4(particle.xyz * uFlowFieldFrequency + 2.0, time))
    );
    flowField = normalize(flowField);
	float audioEnergy = uAudioBands.x * 0.9 + uAudioBands.y * 0.35;
	particle.xyz += flowField * uDeltaTime * strength * (uFlowFieldStrength + audioEnergy);

	// Audio pushes the memory out of the screen instead of acting like a flat EQ.
	vec3 radial = normalize(base.xyz + vec3(0.0001));
	particle.xyz += radial * uAudioBands.x * uDeltaTime * 0.7;
	particle.z += sin(uTime * 4.0 + base.x * 7.0 + base.y * 5.0)
		* uAudioBands.y * uDeltaTime * 0.32;

	// Hand/cursor force. Positive values attract; negative values repel.
	vec3 toAttractor = uAttractor - particle.xyz;
	float distanceToAttractor = length(toAttractor);
	float falloff = 1.0 - smoothstep(0.0, uAttractorRadius, distanceToAttractor);
	if (distanceToAttractor > 0.001) {
		particle.xyz += normalize(toAttractor) * uAttractorStrength * falloff * uDeltaTime;
	}

    // Decay
	particle.a += uDeltaTime * uLifeSpeed * (1.0 + uAudioBands.z * 0.6);
  }

  gl_FragColor = particle;
}

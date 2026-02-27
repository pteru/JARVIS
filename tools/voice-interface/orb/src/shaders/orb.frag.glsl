// JARVIS Energy Orb — Fragment Shader
// Fresnel rim glow with color blending and transparency

precision highp float;

uniform vec3 u_color;
uniform vec3 u_glowColor;
uniform float u_time;

varying vec3 vNormal;
varying vec3 vPosition;
varying vec3 vViewPosition;

void main() {
  // Fresnel calculation
  vec3 viewDir = normalize(vViewPosition);
  vec3 normal = normalize(vNormal);
  float fresnel = 1.0 - abs(dot(viewDir, normal));
  fresnel = pow(fresnel, 2.5);

  // Subtle inner shimmer using position-based variation
  float shimmer = sin(vPosition.x * 8.0 + u_time * 0.5) *
                  sin(vPosition.y * 8.0 + u_time * 0.7) *
                  sin(vPosition.z * 8.0 + u_time * 0.3);
  shimmer = shimmer * 0.05 + 0.95;

  // Mix base color with glow color based on fresnel
  vec3 color = mix(u_color * shimmer, u_glowColor, fresnel * 0.8);

  // Add bright rim highlight
  color += u_glowColor * fresnel * 0.5;

  // Alpha: slight transparency at center, more opaque at edges
  float alpha = mix(0.6, 1.0, fresnel);

  // Boost overall brightness for bloom to pick up
  color *= 1.2;

  gl_FragColor = vec4(color, alpha);
}

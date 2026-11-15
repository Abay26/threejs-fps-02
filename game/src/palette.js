// The look plan, in one place. Meridian Yard is a sun-baked industrial yard at dusk:
// warm concrete, rusted containers, amber Vanguard vs teal Sentinel. Every colour the
// game uses is one of these names; the same names are the CSS custom properties in
// index.html, so the 3D scene and the HUD share one palette.
export const PALETTE = {
  canvas: '#191512', // dusk sky / fog
  ground: '#3a352e', // yard concrete
  concrete: '#6b655a', // walls, light concrete
  concreteDark: '#4a453d', // dark concrete
  rust: '#8a4b2a', // rusted container A
  ochre: '#b07f2e', // container B
  teal: '#2e7f7a', // container C + Sentinel team
  steel: '#7d838a', // metal, crane, barrels
  amber: '#f0a830', // Vanguard team + accent
  ink: '#efe9dc', // HUD text, bright surfaces
  muted: '#a49c8c', // dim HUD text
  hazard: '#d8b13a', // hazard stripes
  spike: '#e2483d', // the spike device
};

export function hex(name) {
  return PALETTE[name];
}

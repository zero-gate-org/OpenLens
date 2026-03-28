// Built-in SVG Sticker Library
// 20 hand-crafted inline SVG stickers — no external resources

export const SVG_STICKERS = [
  {
    name: '4-Point Star',
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <polygon points="50,5 61,39 95,39 68,60 79,95 50,73 21,95 32,60 5,39 39,39"
               fill="#FFD700" stroke="#E6B800" stroke-width="2"/>
    </svg>`
  },
  {
    name: '5-Point Star',
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <polygon points="50,3 63,35 98,38 72,60 80,95 50,75 20,95 28,60 2,38 37,35"
               fill="#FF6B35" stroke="#CC5529" stroke-width="2"/>
    </svg>`
  },
  {
    name: 'Star Burst',
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <polygon points="50,0 56,40 100,30 62,50 100,70 56,60 50,100 44,60 0,70 38,50 0,30 44,40"
               fill="#FFEB3B" stroke="#F9A825" stroke-width="1.5"/>
    </svg>`
  },
  {
    name: 'Solid Heart',
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path d="M50,88 C20,60 5,40 5,28 C5,12 20,3 35,3 C42,3 48,7 50,12 C52,7 58,3 65,3 C80,3 95,12 95,28 C95,40 80,60 50,88Z"
            fill="#E53935" stroke="#C62828" stroke-width="2"/>
    </svg>`
  },
  {
    name: 'Outlined Heart',
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path d="M50,88 C20,60 5,40 5,28 C5,12 20,3 35,3 C42,3 48,7 50,12 C52,7 58,3 65,3 C80,3 95,12 95,28 C95,40 80,60 50,88Z"
            fill="none" stroke="#E53935" stroke-width="4"/>
    </svg>`
  },
  {
    name: 'Broken Heart',
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path d="M50,88 C20,60 5,40 5,28 C5,12 20,3 35,3 C42,3 48,7 50,12"
            fill="none" stroke="#E53935" stroke-width="4" stroke-linecap="round"/>
      <path d="M50,12 C52,7 58,3 65,3 C80,3 95,12 95,28 C95,40 80,60 50,88"
            fill="none" stroke="#E53935" stroke-width="4" stroke-linecap="round"/>
      <path d="M50,25 L58,50 L45,55 L55,80" fill="none" stroke="#E53935" stroke-width="3" stroke-linecap="round"/>
    </svg>`
  },
  {
    name: 'Arrow Right',
    svg: `<svg viewBox="0 0 100 60" xmlns="http://www.w3.org/2000/svg">
      <path d="M5,30 L80,30 M65,15 L80,30 L65,45" fill="none" stroke="#2196F3" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`
  },
  {
    name: 'Arrow Left',
    svg: `<svg viewBox="0 0 100 60" xmlns="http://www.w3.org/2000/svg">
      <path d="M95,30 L20,30 M35,15 L20,30 L35,45" fill="none" stroke="#2196F3" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`
  },
  {
    name: 'Curved Arrow',
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path d="M15,75 C15,25 85,25 85,75" fill="none" stroke="#4CAF50" stroke-width="5" stroke-linecap="round"/>
      <path d="M75,65 L85,75 L75,85" fill="none" stroke="#4CAF50" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`
  },
  {
    name: 'Speech Bubble',
    svg: `<svg viewBox="0 0 100 80" xmlns="http://www.w3.org/2000/svg">
      <path d="M10,5 H90 C95,5 95,10 95,15 V50 C95,55 90,55 85,55 H35 L20,70 L25,55 H10 C5,55 5,50 5,45 V10 C5,5 10,5 10,5Z"
            fill="#FFFFFF" stroke="#333" stroke-width="2"/>
    </svg>`
  },
  {
    name: 'Spiky Bubble',
    svg: `<svg viewBox="0 0 100 85" xmlns="http://www.w3.org/2000/svg">
      <path d="M50,5 L58,20 L75,10 L68,28 L90,25 L72,38 L95,45 L72,50 L88,65 L68,55 L65,75 L50,58 L35,75 L32,55 L12,65 L28,50 L5,45 L28,38 L10,25 L32,28 L25,10 L42,20Z"
            fill="#FFF176" stroke="#F9A825" stroke-width="2"/>
    </svg>`
  },
  {
    name: 'Thought Bubble',
    svg: `<svg viewBox="0 0 100 85" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="50" cy="35" rx="42" ry="28" fill="#FFFFFF" stroke="#333" stroke-width="2"/>
      <circle cx="28" cy="70" r="8" fill="#FFFFFF" stroke="#333" stroke-width="2"/>
      <circle cx="15" cy="80" r="5" fill="#FFFFFF" stroke="#333" stroke-width="2"/>
    </svg>`
  },
  {
    name: 'Circle Badge',
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="45" fill="#1565C0" stroke="#0D47A1" stroke-width="3"/>
      <circle cx="50" cy="50" r="38" fill="none" stroke="#42A5F5" stroke-width="2"/>
    </svg>`
  },
  {
    name: 'Hexagon Badge',
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <polygon points="50,3 93,25 93,75 50,97 7,75 7,25"
               fill="#7B1FA2" stroke="#4A148C" stroke-width="3"/>
      <polygon points="50,15 83,32 83,68 50,85 17,68 17,32"
               fill="none" stroke="#CE93D8" stroke-width="2"/>
    </svg>`
  },
  {
    name: 'Shield Badge',
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path d="M50,5 L90,20 V55 C90,75 70,90 50,97 C30,90 10,75 10,55 V20Z"
            fill="#2E7D32" stroke="#1B5E20" stroke-width="3"/>
      <path d="M50,17 L80,29 V53 C80,68 65,80 50,86 C35,80 20,68 20,53 V29Z"
            fill="none" stroke="#66BB6A" stroke-width="2"/>
    </svg>`
  },
  {
    name: 'Ribbon',
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path d="M15,10 H85 V70 L50,55 L15,70Z" fill="#E91E63" stroke="#AD1457" stroke-width="2"/>
      <path d="M35,10 V45 M50,10 V50 M65,10 V45" fill="none" stroke="#F48FB1" stroke-width="2"/>
    </svg>`
  },
  {
    name: 'Crown',
    svg: `<svg viewBox="0 0 100 70" xmlns="http://www.w3.org/2000/svg">
      <path d="M5,55 L15,15 L35,40 L50,5 L65,40 L85,15 L95,55Z"
            fill="#FFD54F" stroke="#F9A825" stroke-width="2" stroke-linejoin="round"/>
      <rect x="5" y="55" width="90" height="12" rx="2" fill="#FFA000" stroke="#E65100" stroke-width="1.5"/>
      <circle cx="15" cy="15" r="4" fill="#FF7043"/>
      <circle cx="50" cy="5" r="4" fill="#E53935"/>
      <circle cx="85" cy="15" r="4" fill="#FF7043"/>
    </svg>`
  },
  {
    name: 'Lightning',
    svg: `<svg viewBox="0 0 60 100" xmlns="http://www.w3.org/2000/svg">
      <polygon points="35,0 10,50 28,50 15,100 55,40 35,40 50,0"
               fill="#FFEB3B" stroke="#F9A825" stroke-width="2" stroke-linejoin="round"/>
    </svg>`
  },
  {
    name: 'Checkmark',
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="45" fill="#4CAF50" stroke="#2E7D32" stroke-width="3"/>
      <path d="M28,52 L42,66 L72,32" fill="none" stroke="#FFFFFF" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`
  },
  {
    name: 'X Mark',
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="45" fill="#E53935" stroke="#B71C1C" stroke-width="3"/>
      <path d="M32,32 L68,68 M68,32 L32,68" fill="none" stroke="#FFFFFF" stroke-width="8" stroke-linecap="round"/>
    </svg>`
  },
  {
    name: 'Sparkles',
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path d="M50,10 L54,40 L80,20 L56,42 L90,50 L56,58 L80,80 L54,60 L50,90 L46,60 L20,80 L44,58 L10,50 L44,42 L20,20 L46,40Z"
            fill="#FFD700" stroke="#F9A825" stroke-width="1.5"/>
    </svg>`
  },
  {
    name: 'Magnifying Glass',
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <circle cx="42" cy="42" r="30" fill="none" stroke="#546E7A" stroke-width="6"/>
      <line x1="63" y1="63" x2="90" y2="90" stroke="#546E7A" stroke-width="8" stroke-linecap="round"/>
      <circle cx="42" cy="42" r="20" fill="rgba(144,202,249,0.3)"/>
    </svg>`
  },
  {
    name: 'Question Mark',
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="45" fill="#FF9800" stroke="#E65100" stroke-width="3"/>
      <path d="M38,35 C38,22 62,22 62,38 C62,48 50,50 50,60" fill="none" stroke="#FFFFFF" stroke-width="7" stroke-linecap="round"/>
      <circle cx="50" cy="75" r="5" fill="#FFFFFF"/>
    </svg>`
  },
  {
    name: 'Polaroid Frame',
    svg: `<svg viewBox="0 0 100 110" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="3" width="94" height="104" rx="2" fill="#FFFFFF" stroke="#BDBDBD" stroke-width="2"/>
      <rect x="10" y="10" width="80" height="65" fill="#E0E0E0"/>
      <rect x="10" y="10" width="80" height="65" fill="none" stroke="#BDBDBD" stroke-width="1"/>
    </svg>`
  },
  {
    name: 'Film Strip',
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect x="5" y="5" width="90" height="90" rx="3" fill="#212121" stroke="#424242" stroke-width="2"/>
      <rect x="5" y="5" width="90" height="12" fill="#212121"/>
      <rect x="5" y="83" width="90" height="12" fill="#212121"/>
      ${[10,25,40,55,70,85].map(x => `<rect x="${x}" y="7" width="8" height="8" rx="1" fill="#616161"/>`).join('')}
      ${[10,25,40,55,70,85].map(x => `<rect x="${x}" y="85" width="8" height="8" rx="1" fill="#616161"/>`).join('')}
      <rect x="12" y="22" width="76" height="56" fill="#424242"/>
    </svg>`
  }
];

// Icônes (trait 24 px, même épaisseur partout) et illustrations des écrans vides.
const ICONS = {
  clients: '<path d="M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19"/><circle cx="10" cy="7.5" r="3.5"/><path d="M20 19v-1.3a3.2 3.2 0 0 0-2.4-3.1"/><path d="M15.5 4.2a3.4 3.4 0 0 1 0 6.6"/>',
  commandes: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="m9 14 2 2 4-4"/>',
  vehicules: '<path d="M5 16H3.8a.8.8 0 0 1-.8-.8v-3.1c0-.7.4-1.3 1-1.6l1.3-.6L7 6.9A2 2 0 0 1 8.8 6h6.4a2 2 0 0 1 1.8 1l1.7 2.9 1.3.6c.6.3 1 .9 1 1.6v3.1a.8.8 0 0 1-.8.8H19"/><path d="M9 16h6"/><circle cx="7" cy="16" r="2"/><circle cx="17" cy="16" r="2"/><path d="M5.5 10h13"/>',
  stock: '<path d="M3 21V9l9-5 9 5v12"/><path d="M7 21v-8h10v8"/><path d="M7 17h10"/>',
  reprise: '<path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/><path d="M9 13.5h6M8.5 11l1-2h5l1 2"/>',
  reglages: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  donnees: '<path d="M4 20h16"/><rect x="5.5" y="11" width="3" height="6.5" rx="1"/><rect x="10.5" y="6.5" width="3" height="11" rx="1"/><rect x="15.5" y="13.5" width="3" height="4" rx="1"/>',
  planning: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M8 14h2M14 14h2M8 17h2"/>',
  leads: '<path d="m11 17 2 2a1.4 1.4 0 0 0 2-2"/><path d="m14 14 2.5 2.5a1.4 1.4 0 0 0 2-2l-3.9-3.9a3 3 0 0 0-4.2 0l-.9.9a1.4 1.4 0 0 1-2-2l2.8-2.8a5.2 5.2 0 0 1 6.2-.8l.5.3a3 3 0 0 0 2.1.4L21 6"/><path d="m21 4.5 1 8-2 1.5"/><path d="M3 4.5 2 12.5l6.5 6.5a1.4 1.4 0 0 0 2-2"/><path d="M3 5h8"/>',
  depot: '<circle cx="7.5" cy="15.5" r="4"/><path d="m10.4 12.6 9.1-9.1"/><path d="m16 7 3 3"/><path d="m13.5 9.5 2 2"/>',
  administratif: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M8 13h8M8 16h5"/>',
  abonnements: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19"/><path d="M6.5 15h4"/>',
  nuage: '<path d="M17.5 19a4.5 4.5 0 1 0-1.4-8.8A6 6 0 0 0 4.5 12.5 3.5 3.5 0 0 0 6 19z"/>',
  recherche: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  whatsapp: '<path d="M3.5 20.5l1.3-4.2A8.5 8.5 0 1 1 8 19.4z"/><path d="M9 8.6c0 3 2.4 5.9 5.6 6.4.6.1 1.3-.4 1.4-1l.1-.6-1.8-.9-.8.9c-1.2-.5-2.2-1.5-2.7-2.7l.9-.8-.9-1.8-.6.1c-.6.1-1.1.8-1.2 1.4z"/>',
};

const icon = (name, size = 22) =>
  `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

// Illustrations (couleurs reprises des variables CSS, donc adaptées au mode sombre).
const ILLUS = {
  clients: `<svg viewBox="0 0 200 140" aria-hidden="true">
    <ellipse cx="100" cy="126" rx="70" ry="8" fill="var(--illus-shadow)"/>
    <rect x="34" y="22" width="132" height="92" rx="14" fill="var(--illus-card)" stroke="var(--line)"/>
    <circle cx="72" cy="58" r="16" fill="var(--illus-soft)"/><circle cx="72" cy="53" r="7" fill="var(--primary)"/>
    <path d="M60 70a12 9 0 0 1 24 0" fill="var(--primary)"/>
    <rect x="98" y="48" width="48" height="7" rx="3.5" fill="var(--text)" opacity=".8"/>
    <rect x="98" y="62" width="34" height="6" rx="3" fill="var(--muted)" opacity=".5"/>
    <rect x="54" y="88" width="92" height="6" rx="3" fill="var(--muted)" opacity=".3"/>
    <rect x="54" y="99" width="64" height="6" rx="3" fill="var(--muted)" opacity=".3"/>
    <circle cx="160" cy="28" r="14" fill="var(--accent)"/><path d="M160 21v14M153 28h14" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
  </svg>`,
  commandes: `<svg viewBox="0 0 200 140" aria-hidden="true">
    <ellipse cx="100" cy="126" rx="62" ry="8" fill="var(--illus-shadow)"/>
    <rect x="58" y="14" width="84" height="106" rx="10" fill="var(--illus-card)" stroke="var(--line)"/>
    <rect x="72" y="30" width="40" height="7" rx="3.5" fill="var(--text)" opacity=".8"/>
    <rect x="72" y="46" width="56" height="5" rx="2.5" fill="var(--muted)" opacity=".35"/>
    <rect x="72" y="57" width="48" height="5" rx="2.5" fill="var(--muted)" opacity=".35"/>
    <rect x="72" y="68" width="52" height="5" rx="2.5" fill="var(--muted)" opacity=".35"/>
    <path d="M72 88h56" stroke="var(--line)" stroke-width="2"/>
    <rect x="98" y="96" width="30" height="8" rx="4" fill="var(--primary)"/>
    <circle cx="146" cy="96" r="18" fill="var(--green)"/><path d="m137 96 6 6 12-12" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
  stock: `<svg viewBox="0 0 200 140" aria-hidden="true">
    <ellipse cx="100" cy="128" rx="80" ry="7" fill="var(--illus-shadow)"/>
    <path d="M24 124V56l76-38 76 38v68" fill="var(--illus-card)" stroke="var(--line)" stroke-width="2" stroke-linejoin="round"/>
    <rect x="50" y="70" width="100" height="54" rx="4" fill="var(--illus-soft)"/>
    <path d="M50 82h100M50 94h100" stroke="var(--illus-card)" stroke-width="3" opacity=".7"/>
    <path d="M62 116h-6a3 3 0 0 1-3-3v-7c0-2 1-3 3-4l4-2 6-9c1-2 3-3 5-3h26c2 0 4 1 5 3l6 9 4 2c2 1 3 2 3 4v7a3 3 0 0 1-3 3h-6" fill="var(--primary)"/>
    <circle cx="70" cy="116" r="7" fill="var(--text)"/><circle cx="70" cy="116" r="3" fill="var(--illus-card)"/>
    <circle cx="122" cy="116" r="7" fill="var(--text)"/><circle cx="122" cy="116" r="3" fill="var(--illus-card)"/>
    <path d="M72 96l4-6h34l4 6z" fill="var(--illus-card)" opacity=".85"/>
  </svg>`,
  reprise: `<svg viewBox="0 0 200 140" aria-hidden="true">
    <ellipse cx="100" cy="126" rx="74" ry="8" fill="var(--illus-shadow)"/>
    <circle cx="100" cy="70" r="52" fill="none" stroke="var(--illus-soft)" stroke-width="10"/>
    <path d="M148 52a52 52 0 0 0-86-20" fill="none" stroke="var(--accent)" stroke-width="10" stroke-linecap="round"/>
    <path d="M58 22l2 14 14-3" fill="none" stroke="var(--accent)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M70 92h-6a3 3 0 0 1-3-3v-7c0-2 1-3 3-4l4-2 6-9c1-2 3-3 5-3h26c2 0 4 1 5 3l6 9 4 2c2 1 3 2 3 4v7a3 3 0 0 1-3 3h-6" fill="var(--primary)"/>
    <circle cx="78" cy="92" r="7" fill="var(--text)"/><circle cx="78" cy="92" r="3" fill="var(--illus-card)"/>
    <circle cx="122" cy="92" r="7" fill="var(--text)"/><circle cx="122" cy="92" r="3" fill="var(--illus-card)"/>
    <path d="M80 72l4-6h34l4 6z" fill="var(--illus-card)" opacity=".85"/>
    <rect x="86" y="104" width="28" height="10" rx="2" fill="var(--illus-card)" stroke="var(--text)" stroke-width="1.5"/>
  </svg>`,
  planning: `<svg viewBox="0 0 200 140" aria-hidden="true">
    <ellipse cx="100" cy="128" rx="70" ry="7" fill="var(--illus-shadow)"/>
    <rect x="44" y="20" width="112" height="100" rx="12" fill="var(--illus-card)" stroke="var(--line)"/>
    <path d="M44 32a12 12 0 0 1 12-12h88a12 12 0 0 1 12 12v12H44z" fill="var(--primary)"/>
    <rect x="70" y="12" width="6" height="18" rx="3" fill="var(--text)"/><rect x="124" y="12" width="6" height="18" rx="3" fill="var(--text)"/>
    <g fill="var(--illus-soft)">
      <rect x="58" y="56" width="18" height="14" rx="3"/><rect x="82" y="56" width="18" height="14" rx="3"/><rect x="106" y="56" width="18" height="14" rx="3"/><rect x="130" y="56" width="14" height="14" rx="3"/>
      <rect x="58" y="78" width="18" height="14" rx="3"/><rect x="106" y="78" width="18" height="14" rx="3"/><rect x="130" y="78" width="14" height="14" rx="3"/>
      <rect x="58" y="100" width="18" height="12" rx="3"/><rect x="82" y="100" width="18" height="12" rx="3"/>
    </g>
    <rect x="82" y="78" width="18" height="14" rx="3" fill="var(--accent)"/>
    <circle cx="150" cy="104" r="20" fill="var(--illus-card)" stroke="var(--text)" stroke-width="3"/>
    <path d="M150 93v11l7 5" fill="none" stroke="var(--text)" stroke-width="3" stroke-linecap="round"/>
  </svg>`,
};

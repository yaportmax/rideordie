// Built-in menu backdrop: a stylised sunset chase (SVG, animated with CSS only). Used by title / lobby / results / settings unless the
// integrator passes { backdrop:false } to the Ui (garage never draws it: the 3D garage shows through the transparent overlay).

const TRUCK = `
  <g class="rim">
    <!-- bed cage -->
    <path d="M26 -104V-196H168V-104M96 -104V-196M26 -150H168" fill="none" stroke="#0b0706" stroke-width="7"/>
    <!-- body -->
    <path d="M6 -48L4 -104H176L184 -112L196 -176Q200 -190 214 -190H262L296 -124L350 -118Q366 -116 370 -100L372 -56L350 -42Z" fill="#0b0706"/>
    <path d="M204 -178H258L286 -128H196Z" fill="#26120d" opacity=".9"/>
    <!-- exhaust stack + spotlights + spikes -->
    <rect x="182" y="-268" width="9" height="160" fill="#0b0706"/>
    <path d="M180 -268h13l-3 -10h-7z" fill="#0b0706"/>
    <path d="M372 -96l30 -6l-30 -10zM372 -80l32 -2l-32 -12zM372 -64l28 4l-28 -12z" fill="#0b0706"/>
    <rect x="130" y="-206" width="26" height="12" rx="3" fill="#0b0706"/><rect x="40" y="-206" width="26" height="12" rx="3" fill="#0b0706"/>
    <!-- gunner -->
    <path d="M78 -104V-160Q78 -176 96 -178Q114 -176 114 -160V-104Z" fill="#0b0706"/>
    <circle cx="96" cy="-198" r="15" fill="#0b0706"/>
    <path d="M80 -204q16 -14 32 0l-2 6h-28z" fill="#3a1a10"/>
    <path d="M100 -170L-36 -196L-40 -186L98 -156z" fill="#0b0706"/>
    <path d="M-36 -196l-26 -8l4 14l-22 4z" fill="#ffd27a" class="flash"/>
    <!-- wheels -->
    <g fill="#0b0706" stroke="#2a1710" stroke-width="5"><circle cx="82" cy="-30" r="46"/><circle cx="292" cy="-30" r="46"/></g>
    <g fill="none" stroke="#e8792b" stroke-opacity=".28" stroke-width="3"><circle cx="82" cy="-30" r="21"/><circle cx="292" cy="-30" r="21"/></g>
  </g>`;

const SEDAN = `
  <g class="rim">
    <path d="M0 -32L4 -58L66 -64L92 -100L158 -102L188 -66L246 -60L254 -34L240 -24H12Z" fill="#0b0706"/>
    <path d="M100 -94H152L176 -68H86Z" fill="#26120d"/>
    <circle cx="58" cy="-24" r="28" fill="#0b0706" stroke="#2a1710" stroke-width="4"/><circle cx="196" cy="-24" r="28" fill="#0b0706" stroke="#2a1710" stroke-width="4"/>
    <path d="M110 -100q6 -24 22 -24q16 0 18 24z" fill="#0b0706"/>
    <path d="M150 -118L216 -134L214 -126L152 -108z" fill="#0b0706"/>
    <path d="M216 -134l24 -8l-6 14l16 6z" fill="#ffd27a" class="flash"/>
  </g>`;

export function backdropSvg() {
  const stripes = Array.from({ length: 7 }, (_, i) => `<rect x="1100" y="${560 + i * 22 + i * i * 2.4}" width="500" height="${3 + i * 1.7}" fill="#0b0706"/>`).join('');
  const dust = Array.from({ length: 7 }, (_, i) => `<circle class="pf pf${i % 4}" fill="url(#dustg)" cx="${40 - i * 26}" cy="${-30 - (i % 3) * 14}" r="${36 + i * 9}" style="animation-delay:${i * 0.42}s"/>`).join('');
  return `<svg class="bgsvg" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#160d10"/><stop offset=".3" stop-color="#3d1a1c"/><stop offset=".55" stop-color="#9c3f1f"/><stop offset=".72" stop-color="#e8792b"/><stop offset=".84" stop-color="#ffb43a"/><stop offset="1" stop-color="#ffd76a"/></linearGradient>
      <radialGradient id="sun" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff7c8"/><stop offset=".55" stop-color="#ffd24a"/><stop offset="1" stop-color="#ff9a2e"/></radialGradient>
      <radialGradient id="glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffc21a" stop-opacity=".55"/><stop offset=".5" stop-color="#e8792b" stop-opacity=".18"/><stop offset="1" stop-color="#e8792b" stop-opacity="0"/></radialGradient>
      <linearGradient id="road" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b1e19"/><stop offset="1" stop-color="#0d0908"/></linearGradient>
      <linearGradient id="haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb43a" stop-opacity="0"/><stop offset="1" stop-color="#ffb43a" stop-opacity=".55"/></linearGradient>
      <radialGradient id="dustg" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#e2b27a" stop-opacity=".9"/><stop offset="1" stop-color="#b87a48" stop-opacity="0"/></radialGradient>
      <mask id="sunmask"><rect width="1920" height="1080" fill="#fff"/>${stripes}</mask>
    </defs>
    <rect width="1920" height="1080" fill="url(#sky)"/>
    <g class="stars" fill="#ffe9b8" opacity=".5"><circle cx="220" cy="90" r="1.6"/><circle cx="520" cy="160" r="1.2"/><circle cx="880" cy="70" r="1.6"/><circle cx="1240" cy="130" r="1.2"/><circle cx="1600" cy="80" r="1.8"/><circle cx="1780" cy="210" r="1.2"/><circle cx="360" cy="260" r="1"/><circle cx="1010" cy="240" r="1"/></g>
    <circle cx="1330" cy="640" r="620" fill="url(#glow)"/>
    <circle cx="1330" cy="640" r="215" fill="url(#sun)" mask="url(#sunmask)" class="sun"/>
    <!-- far mesas -->
    <path d="M0 720V640L60 636L96 600H190L214 640L330 646L372 690H460L500 626L548 622L590 676L700 682L728 650H860L890 690L1010 700L1060 640L1150 636L1190 690L1300 700L1330 668H1450L1490 700H1600L1640 630L1720 626L1760 690L1920 700V760H0Z" fill="#8a3418" opacity=".85"/>
    <path d="M0 740V690L120 684L170 720L300 726L340 700H450L500 740L640 746L700 712L820 708L880 748L1040 752L1090 716H1230L1280 752L1420 758L1470 720L1610 716L1650 756L1780 756L1830 730L1920 736V780H0Z" fill="#5c2212"/>
    <rect x="0" y="700" width="1920" height="90" fill="url(#haze)"/>
    <!-- dunes -->
    <path d="M0 790Q220 752 470 782T960 776T1460 786T1920 770V860H0Z" fill="#33150e"/>
    <!-- ground / road -->
    <rect x="0" y="800" width="1920" height="280" fill="#1a0f0b"/>
    <path d="M0 850H1920V1080H0Z" fill="url(#road)"/>
    <rect x="0" y="850" width="1920" height="4" fill="#e8792b" opacity=".35"/>
    <g class="lane"><path d="M-200 962H2200" stroke="#ffc21a" stroke-opacity=".5" stroke-width="7" stroke-dasharray="90 80" fill="none"/></g>
    <rect x="0" y="1040" width="1920" height="40" fill="#0b0706" opacity=".6"/>
    <!-- tracers -->
    <g class="tracers" fill="none" stroke="#ffd27a" stroke-linecap="round">
      <line class="tr t1" x1="452" y1="838" x2="880" y2="800" stroke-width="4"/>
      <line class="tr t2" x1="452" y1="838" x2="900" y2="860" stroke-width="3"/>
      <line class="tr t3" x1="330" y1="900" x2="880" y2="870" stroke-width="3"/>
    </g>
    <!-- chasers -->
    <g transform="translate(140 930) scale(1.15)">${SEDAN}</g>
    <g transform="translate(-40 1010) scale(1.5)" opacity=".95">${SEDAN}</g>
    <!-- hero truck with dust trail -->
    <g transform="translate(940 992) scale(1.85)" class="hero">
      <g class="dust">${dust}</g>
      ${TRUCK}
    </g>
  </svg>`;
}

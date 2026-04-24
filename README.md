<div align="center">

# 📡 LAN Share

**Transfè fichye sou rezo lokal — tankou AirDrop, men pou tout moun.**

[![Electron](https://img.shields.io/badge/Electron-28+-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux-blue?style=flat-square)](https://github.com)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)](CONTRIBUTING.md)

*Pataje fichye ant òdinatè sou menm WiFi a — san entènèt, san cloud, san kont.*

![LAN Share Screenshot](assets/icons/icon.svg)

</div>

---

## ✨ Karakteristik

- 🔍 **Dekouvèt otomatik** — jwenn lòt aparèy sou menm WiFi a nan kèk segond (UDP broadcast)
- 🔐 **Pairing PIN** — koneksyon sekirize ak kòd 4 chif
- 📦 **Transfè multi-fichye** — voye plizyè fichye ansanm
- 📊 **Pwogresyon tan reyèl** — wè % ak bytes transféré
- 🔒 **Chifraj AES-256-CBC** — tout chunk yo chifre sou fil la
- 🖥️ **Cross-platform** — Windows (`.exe`) ak Linux (`.AppImage`)
- 🌐 **100% offline** — pa bezwen entènèt ditou

---

## 🖼️ Aperçu

```
┌──────────────────────────────────────────────────────┐
│  📡 LAN Share                    ● john@laptop       │
├─────────────────────┬────────────────────────────────┤
│  Nearby Devices  2  │                                │
│  ─────────────────  │   💻  Marie@PC                 │
│  💻 Marie@PC        │   192.168.1.42:51234           │
│  🖥️ Server-01       │                                │
│                     │   [  Drop files here  ]        │
│  ◉ Scanning…        │                                │
│                     │   📄 rapport.pdf    2.4 MB     │
│                     │   🎬 video.mp4      48 MB      │
│                     │                                │
│                     │   PIN: [ 7 ][ 5 ][ 1 ][ 0 ]   │
│                     │                                │
│                     │   [  ▶ Send Files  ]           │
│                     │   ████████░░░░  67% — 32 MB    │
└─────────────────────┴────────────────────────────────┘
```

---

## 🏗️ Achitekti

```
lan-share-app/
│
├── main.js                 ← Electron main process (IPC hub)
├── preload.js              ← Context bridge sekirize
├── generate-assets.js      ← Jenere logo + icons otomatikman
│
├── network/
│   ├── discovery.js        ← UDP broadcast (dekouvèt aparèy)
│   ├── connection.js       ← TCP server + handshake + PIN
│   ├── fileTransfer.js     ← Streaming chunks + framing
│   └── encryption.js       ← AES-256-CBC + PBKDF2
│
├── renderer/
│   ├── index.html          ← UI shell
│   ├── style.css           ← Dark premium design system
│   └── app.js              ← Lojik UI + IPC listeners
│
└── assets/icons/           ← Logo SVG, PNG, ICO (auto-jenere)
```

---

## 🔒 Sekirite

| Kouch | Mekanis |
|---|---|
| Otantifikasyon | PIN 4 chif jenere aléatoireman côté resevwa |
| Kle chifraj | PBKDF2 (100 000 iterasyon, SHA-256) soti PIN + salt |
| Chifraj chunk | AES-256-CBC ak IV fre pou chak chunk |
| Izolasyon | Renderer pa gen aksè dirèk Node.js (`contextBridge` sèlman) |

> Tout transfè fèt **sou LAN sèlman** — okenn done pa janm soti sou rezo lokal la.

---

## 🚀 Kòmanse

### Prérequis

- [Node.js](https://nodejs.org/) `>= 18`
- [Git](https://git-scm.com/)

### Enstalasyon

```bash
# Klone repo a
git clone https://github.com/TON-USERNAME/lan-share.git
cd lan-share

# Enstale depandans
npm install

# Jenere logo ak icons
node generate-assets.js

# Lanse app la
npm start
```

### Pou vrè PNG/ICO (kalite maksimòm)

```bash
npm install canvas
node generate-assets.js
```

---

## 📦 Build pou distribisyon

```bash
# Windows (.exe NSIS installer)
npm run build:win

# Linux (.AppImage)
npm run build:linux

# Tou de
npm run build
```

Fichye output yo nan dosye `dist/`.

---

## 🔄 Flou aplikasyon

```
Aparèy A (Expéditeur)          Aparèy B (Resevwa)
──────────────────────         ──────────────────────
1. Lanse app                   1. Lanse app
2. UDP beacon broadcast ──────→ Resevwa beacon
3. Wè "Aparèy B" nan lis       2. Wè "Aparèy A" nan lis
4. Klike sou aparèy B
5. Chwazi fichye yo
6. TCP connect ────────────→   3. "Aparèy A" vle konekte
                               4. Klike Aksepte
                               5. Wè PIN: 7510
6. Antre PIN: 7510
7. PIN verifye ✓
8. AES key derive (PBKDF2)     6. AES key derive (menm)
9. Voye fichye (chifre) ──────→ 7. Resevwa + dechifre
10. Transfè konplè ✓           8. Fichye sove nan ~/LAN Share Downloads/
```

---

## 🛠️ Teknoloji

| Teknoloji | Itilizasyon |
|---|---|
| **Electron 28** | Desktop app framework |
| **Node.js `dgram`** | UDP discovery broadcast |
| **Node.js `net`** | TCP koneksyon + streaming |
| **Node.js `crypto`** | AES-256-CBC + PBKDF2 |
| **Node.js `fs`** | Lekti/ekri fichye |
| **electron-builder** | Build Windows + Linux |

---

## 📡 Protokòl Rezo

### UDP Discovery Beacon (chak 3 sèk)
```json
{
  "type": "LANSHARE_BEACON",
  "id": "0818636bde91416b",
  "name": "john@laptop",
  "tcpPort": 51234,
  "platform": "linux",
  "version": "1.0.0"
}
```

### TCP Handshake
```
Expéditeur → Resevwa:   HELLO { id, name }
Resevwa    → Expéditeur: HELLO_ACK { accepted: true }
Expéditeur → Resevwa:   PIN_ATTEMPT { pin: "7510" }
Resevwa    → Expéditeur: PIN_RESULT { ok: true }
Expéditeur → Resevwa:   [16 bytes salt binè]
── Transfè fichye kòmanse (AES-256-CBC) ──
```

### Framing Mesaj
Tout mesaj yo length-prefixed:
```
[4 bytes LE uint32 = longuè payload][payload bytes]
```

---

## 🤝 Kontribisyon

PR yo byenveni! Pou chanjman majè, tanpri ouvri yon issue premye.

```bash
# Fork → Clone → Branch
git checkout -b feature/non-fonksyon

# Fè chanjman ou yo
git commit -m "feat: ajoute ..."

# Push + Pull Request
git push origin feature/non-fonksyon
```

---

## 📄 Lisans

[MIT](LICENSE) © 2025 LAN Share

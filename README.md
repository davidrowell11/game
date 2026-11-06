# Depthwarden

A 3D roguelite dungeon crawler for **Windows** and **macOS** (Linux too). Every floor is a procedurally generated dungeon. Fight through it, find treasure, pick a new perk each time you level up, and go deeper. When you die, the gold you carried is banked, and you can spend it in the Armory on permanent upgrades for your next run.

![icon](build/icon.png)

---

## Install

### 1. Download

Go to the **[Releases page](https://github.com/davidrowell11/game/releases/latest)** and download the file for your computer:

| Your computer | File to download |
| --- | --- |
| Windows 10 / 11 | `Depthwarden-<version>-win-x64.exe` (installer) |
| Windows, no install | `Depthwarden-<version>-windows-portable.exe` (just run it) |
| Mac with Apple Silicon (M1, M2, M3, M4…) | `Depthwarden-<version>-mac-arm64.dmg` |
| Mac with an Intel processor | `Depthwarden-<version>-mac-x64.dmg` |
| Linux | `Depthwarden-<version>-linux-x86_64.AppImage` |

Not sure which Mac you have? Click the Apple menu  → **About This Mac**. If it says **Chip: Apple M…**, use `arm64`. If it says **Processor: Intel…**, use `x64`.

> Is the Releases page empty? Open the **[Actions tab](https://github.com/davidrowell11/game/actions/workflows/build.yml)**, click the newest green run, and download the installer from the **Artifacts** section at the bottom. You need to be signed in to GitHub, and the files come zipped.

### 2. Windows

1. Double-click `Depthwarden-…-win-x64.exe`.
2. Windows may show **"Windows protected your PC"**. This appears because the game isn't signed with a paid certificate. Click **More info**, then **Run anyway**.
3. Follow the installer. You can choose the install folder. It adds Desktop and Start Menu shortcuts.
4. Launch **Depthwarden** from the Start Menu or the Desktop.

**Uninstall:** Settings → Apps → Installed apps → Depthwarden → Uninstall.

### 3. macOS

1. Double-click the `.dmg` file.
2. Drag **Depthwarden** into the **Applications** folder, then eject the disk image.
3. The first time only, open **Applications**, **right-click** (or Control-click) Depthwarden, choose **Open**, then click **Open** again. macOS asks this because the app isn't notarized by Apple. After the first time, it opens normally.
   - On macOS 15 (Sequoia) or newer, if there's no **Open** button: try to open the app once, then go to **System Settings → Privacy & Security**, scroll down, and click **Open Anyway** next to Depthwarden.
4. If macOS says the app **"is damaged and can't be opened"**, open **Terminal** and run this, then try again:
   ```bash
   xattr -cr /Applications/Depthwarden.app
   ```

**Uninstall:** drag Depthwarden from Applications to the Trash.

### 4. Linux

```bash
chmod +x Depthwarden-*.AppImage
```
```bash
./Depthwarden-*.AppImage
```

### System requirements

- Windows 10/11 (64-bit), macOS 11 Big Sur or newer, or a modern 64-bit Linux
- Any GPU with WebGL 2 support (integrated graphics from the last ~8 years is fine)
- About 300 MB of disk space

---

## How to play

| Input | Action |
| --- | --- |
| **WASD** / Arrow keys | Move |
| **Mouse** | Aim |
| **Left mouse** (hold) | Sword sweep (also knocks enemy projectiles out of the air) |
| **Right mouse** (hold) | Arcane bolt (ranged) |
| **Space** / **Shift** | Dash (you can't be hit during a dash) |
| **E** | Interact: open chests, pray at shrines, descend stairs |
| **Q** | Drink a health potion |
| **Tab** | Toggle the full map |
| **Esc** / **P** | Pause (volume setting is here) |
| **F11** | Fullscreen |
| **1 / 2 / 3** | Pick a perk on the level-up screen |

**The loop**

- **Every floor is generated** from the run seed. Rooms are joined by corridors, and some corridors loop back on themselves. Floors get larger and more dangerous as you go down.
- Find the **glowing portal** (shown in blue on the minimap) and press **E** to go down.
- Every **4th floor** is a **Guardian** floor. The portal stays sealed (red) until the boss dies. Beat the guardian of **floor 12** to win. After that, you can keep descending in endless mode.
- **Gold chests** give you a free perk. **Green shrines** heal you and raise your max health.
- Enemies drop **XP crystals** (green), **gold** and sometimes **potions**. When you level up, pick 1 of 3 random perks: split bolts, lifesteal, thorns, crits, and more.
- **Elite** enemies are bigger, glow orange, and drop better loot.
- When you die, all gold you carried is **banked**. Spend it in the **Armory** on the main menu on permanent upgrades: Vitality, Might, Swiftness, Fortune, Satchel, Second Wind.
- **Seeds:** type a seed on the main menu to replay the same dungeon layouts, or to share a run with a friend. Leave it blank for a random run.

**Enemies:** Husks (melee), Spitters (ranged), Brutes (they telegraph, then charge, and are stunned if they hit a wall), Wisps (fast swarmers), Bone Shamans (summon Husks), and the Hollow Warden boss (bullet novas, aimed fans, ground slams and summons, and it gets enraged below 50% health).

Your progress is saved automatically here:
- Windows: `%APPDATA%\Depthwarden`
- macOS: `~/Library/Application Support/Depthwarden`
- Linux: `~/.config/Depthwarden`

---

## Build from source

You need **Node.js 20 or newer** ([nodejs.org](https://nodejs.org)).

```bash
git clone https://github.com/davidrowell11/game.git
```
```bash
cd game
```
```bash
npm install
```

Run the game in a desktop window:

```bash
npm start
```

Or play it in your browser with live reload while you change the code (opens on http://localhost:5173):

```bash
npm run dev
```

Run the tests (they check that every generated dungeon is fully connected and spawns things in valid places):

```bash
npm test
```

### Build the installers yourself

Each command must run on that operating system:

```bash
npm run dist:win
```
```bash
npm run dist:mac
```
```bash
npm run dist:linux
```

The installers are written to the `release/` folder.

### Automatic builds and releases

The GitHub Actions workflow in `.github/workflows/build.yml` builds the Windows, macOS and Linux installers on every push to `main`. To publish a new version on the Releases page, update `version` in `package.json`, then tag and push:

```bash
git tag v1.0.1
```
```bash
git push origin v1.0.1
```

---

## Project layout

```
src/
  dungeon.js    Procedural generator: room placement, MST + loop corridors, room roles, spawns
  rng.js        Seeded random number generator (every floor is reproducible)
  world.js      Turns the grid into 3D geometry; collision, line of sight, path-finding, fog of war
  game.js       Game loop, combat, floors, interactables, state machine
  player.js     Player model, stats and animation
  enemies.js    Enemy types, models and AI (including the boss patterns)
  perks.js      Level-up perks and base stats
  save.js       Persistent gold and Armory upgrades
  effects.js    Particles, projectiles, pickups, damage numbers
  ui.js         HUD, minimap, menus
  audio.js      Sound effects synthesised at runtime (no audio files)
  textures.js   Procedural textures (no image files)
electron/       Desktop window wrapper
build/          App icon and macOS signing hook
test/           Dungeon generator tests
```

Built with [Three.js](https://threejs.org), [Electron](https://www.electronjs.org) and [electron-builder](https://www.electron.build). All art, textures and sounds are generated in code.

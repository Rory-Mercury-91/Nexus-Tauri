# Nexus (Tauri)

Client de bureau React + Tauri, authentification Supabase.

**Dépôt GitHub :** [github.com/Rory-Mercury-91/Nexus-Tauri](https://github.com/Rory-Mercury-91/Nexus-Tauri)

## Prérequis

- Node.js (LTS)
- [Rust](https://rustup.rs/) + cible Windows MSVC
- Fichier `.env` à partir de `.env.example` (URL + clé anon Supabase)

## Commandes

```powershell
npm install
npm run dev
```

Build installateur Windows (NSIS, utilisateur courant — sans élévation admin par défaut) :

```powershell
npx @tauri-apps/cli build
```

Sortie typique : `src-tauri\target\release\bundle\nsis\Nexus_*_x64-setup.exe`

## Mise à jour automatique

L’URL des releases est configurée dans `src-tauri/tauri.conf.json` (plugin updater). La clé publique correspond au couple généré dans `Z_Dossier_Perso/` (non versionné). Pour signer les artefacts : variables `TAURI_SIGNING_PRIVATE_KEY` ou chemin vers la clé privée — voir [documentation Tauri — updater](https://v2.tauri.app/plugin/updater/).

## Premier envoi vers GitHub

```powershell
cd "F:\Projet GitHub\Nexus-Tauri"
git init
git add .
git commit -m "Initial import Nexus-Tauri"
git branch -M main
git remote add origin https://github.com/Rory-Mercury-91/Nexus-Tauri.git
git push -u origin main
```

# OmniVencord

[Vencord](https://github.com/Vendicated/Vencord) + les plugins **Omni**, avec mises à jour automatiques.
*[English below](#english)*

## Plugins inclus

| Plugin | Ce qu'il fait |
|---|---|
| **OmniFakeNitro** | Emojis/stickers de partout, stream 1080p 60 FPS, avatar/bannière perso, badge Omni, aura néon (couleur au choix), envoi de gros fichiers (jusqu'à 1 Go) |
| **OmniBackground** | Fond d'écran Discord avec tes images et GIF (10 de chaque), enregistrés dans un menu déroulant |
| **OmniNotes** | Panneau avec ta note sur la personne à côté de son profil, modifiable directement |

## Installation

1. Télécharge **OmniInstaller.exe** depuis la [dernière release](../../releases/tag/devbuild).
2. Lance-le. Si Windows affiche « Windows a protégé votre ordinateur » : **Informations complémentaires → Exécuter quand même** (l'exe n'est pas signé).
3. Tape `1` pour installer. Discord se ferme, s'installe, puis se relance.
4. Dans Discord : **Paramètres → Plugins**, active les plugins Omni.

**Mises à jour :** Paramètres → **Updater** → *Mettre à jour*. Tu reçois les nouveautés des plugins Omni **et** de Vencord.
**Après une mise à jour de Discord** qui enlève Vencord : relance OmniInstaller et tape `1`.
**Désinstaller :** relance OmniInstaller et tape `2`.

> ⚠️ Les mods de client comme Vencord sont contraires aux conditions d'utilisation de Discord. Le risque est faible, mais existe. Le support de Vencord n'aide pas pour cette version : pour toute question, contacte **Exprimes**.

## Pour le mainteneur

- Les plugins sont dans `src/plugins/omni*`. Chaque push sur `main` compile et publie la release `devbuild` (`.github/workflows/build.yml`), que le bouton de mise à jour de Vencord lit.
- `.github/workflows/sync-upstream.yml` récupère Vencord chaque jour. S'il échoue (conflit, ou Vencord a modifié ses workflows) : bouton **Sync fork** sur GitHub, puis push.
- Refaire l'exe : `powershell -ExecutionPolicy Bypass -File installer\build-exe.ps1`, puis l'ajouter à la release `devbuild`.

---

## English

[Vencord](https://github.com/Vendicated/Vencord) + the **Omni** plugins, with automatic updates.

1. Download **OmniInstaller.exe** from the [latest release](../../releases/tag/devbuild).
2. Run it. If Windows shows "Windows protected your PC": **More info → Run anyway** (the exe is unsigned).
3. Type `1` to install. Discord closes, gets patched, then restarts.
4. In Discord: **Settings → Plugins**, enable the Omni plugins.

**Updates:** Settings → **Updater** → *Update*: you get both Omni plugin and Vencord updates.
**If a Discord update removes Vencord:** run OmniInstaller again and type `1`. **Uninstall:** run it and type `2`.

> ⚠️ Client mods like Vencord break Discord's Terms of Service. The risk is low but real. Vencord support does not help with this build: contact **Exprimes**.

Licence : GPL-3.0, comme Vencord. OmniFakeNitro est basé sur FakeNitro (auteurs crédités dans le code).

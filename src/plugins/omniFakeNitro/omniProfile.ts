/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Profil Omni partagé : avatar, bannière et couleur d'aura cachés dans la bio en caractères invisibles
// (même technique que FakeProfileThemes : chaque caractère ASCII est décalé dans le bloc Unicode U+E0000).

export interface OmniProfile {
    avatar?: string;
    banner?: string;
    color: string;
}

// Hébergeurs autorisés par défaut dans Vencord : les autres utilisateurs verront l'image sans rien autoriser
export const SHARED_HOSTS = ["files.catbox.moe", "i.imgur.com", "i.ibb.co", "cdn.discordapp.com", "media.discordapp.net"];

// Le lien finit dans un src d'image ou un url() CSS chez les autres : caractères sûrs uniquement
const SAFE_URL = /^https:\/\/[\w.\-~/?=&%+#:]+$/;
const CATBOX = "https://files.catbox.moe/";

export function isShareable(url?: string) {
    if (!url || !SAFE_URL.test(url)) return false;
    try {
        return SHARED_HOSTS.includes(new URL(url).host);
    } catch {
        return false;
    }
}

const shorten = (url?: string) => !isShareable(url) ? "" : url!.startsWith(CATBOX) ? "~" + url!.slice(CATBOX.length) : url!.slice("https://".length);

function expand(s: string) {
    if (!s) return undefined;
    const url = s.startsWith("~") ? CATBOX + s.slice(1) : "https://" + s;
    return isShareable(url) ? url : undefined;
}

const toInvisible = (s: string) => Array.from(s, c => String.fromCodePoint(c.codePointAt(0)! + 0xe0000)).join("");

export function encodeOmniProfile({ avatar, banner, color }: OmniProfile) {
    return toInvisible(`[omni:${shorten(avatar)}|${shorten(banner)}|${color.replace("#", "").toLowerCase()}]`);
}

const DecodeRegex = /\[omni:([^|\]]*)\|([^|\]]*)\|([0-9a-fA-F]{6})\]/;

export function decodeOmniProfile(bio?: string | null): OmniProfile | null {
    if (!bio) return null;

    let ascii = "";
    for (const ch of bio) {
        const cp = ch.codePointAt(0)!;
        if (cp >= 0xe0020 && cp <= 0xe007e) ascii += String.fromCodePoint(cp - 0xe0000);
    }

    const m = ascii.match(DecodeRegex);
    if (!m) return null;

    return { avatar: expand(m[1]), banner: expand(m[2]), color: "#" + m[3].toLowerCase() };
}

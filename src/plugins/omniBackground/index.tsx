/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { definePluginSettings } from "@api/Settings";
import { disableStyle, enableStyle } from "@api/Styles";
import { Button } from "@components/Button";
import { Heading } from "@components/Heading";
import { Link } from "@components/Link";
import { Paragraph } from "@components/Paragraph";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { Select, showToast, TextInput, useState } from "@webpack/common";

import backgroundStyle from "./background.css?managed";

const Native = VencordNative.pluginHelpers.OmniBackground as PluginNative<typeof import("./native")>;

const MAX_PER_TYPE = 10;

type BgType = "image" | "gif";
interface SavedBackground { url: string; type: BgType; }

function detectType(url: string): BgType {
    return /\.gif([?#]|$)/i.test(url) || url.includes("tenor.com") ? "gif" : "image";
}

function labelOf(bg: SavedBackground, list: SavedBackground[]) {
    // Comparaison par url : le store des réglages renvoie un nouvel objet proxy à chaque lecture
    const n = list.filter(b => b.type === bg.type).findIndex(b => b.url === bg.url) + 1;
    let file = bg.url;
    try {
        const u = new URL(bg.url);
        file = `${u.host}/…/${u.pathname.split("/").pop()}`;
    } catch { }
    return `${bg.type === "gif" ? "🎞️ GIF" : "🖼️ Image"} ${n} — ${file}`;
}

// Discord réécrit le style de <html> et les classes de <body> au démarrage : on passe par nos propres <style>
const urlStyle = document.createElement("style");
urlStyle.dataset.vencordName = "omni-bg-url";

function applyBackground() {
    const url = settings.store.selected;

    if (url) {
        urlStyle.textContent = `:root{--omni-bg-url:url("${url}")}`;
        document.head.append(urlStyle);
        enableStyle(backgroundStyle);
        ensureHostAllowed(url);
    } else {
        removeBackground();
    }
}

function removeBackground() {
    urlStyle.remove();
    disableStyle(backgroundStyle);
}

// La CSP de Discord bloque les images de sites inconnus (ex: tenor.com) : on demande l'autorisation via Vencord
function ensureHostAllowed(url: string) {
    const img = new Image();
    img.onerror = async () => {
        try {
            if (await VencordNative.csp.isDomainAllowed(url, ["img-src"])) return;
            const res = await VencordNative.csp.requestAddOverride(url, ["img-src"], "OmniBackground");
            if (res === "ok") showToast({ text: "Site autorisé ! Redémarre Discord pour afficher le fond.", variant: "success" });
        } catch { }
    };
    img.src = url;
}

function BackgroundManager() {
    const { backgrounds, selected } = settings.use(["backgrounds", "selected"]);
    const [input, setInput] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);

    const count = (type: BgType) => backgrounds.filter(b => b.type === type).length;

    function select(url: string) {
        settings.store.selected = url;
        applyBackground();
    }

    async function add() {
        setError("");
        let url = input.trim();
        // Pas de guillemets ni d'antislash : le lien est injecté dans un url("...") CSS
        if (!/^https:\/\/[^\s"'\\]+$/i.test(url)) return setError("Lien invalide : il doit commencer par https:// (sans espaces ni guillemets).");

        if (url.includes("tenor.com") && !/\.gif([?#]|$)/i.test(url)) {
            setBusy(true);
            try { url = await Native.resolveBackgroundUrl(url); } catch { }
            setBusy(false);
        }

        const type = detectType(url);
        if (backgrounds.some(b => b.url === url)) return setError("Ce fond est déjà enregistré.");
        if (count(type) >= MAX_PER_TYPE)
            return setError(`Limite atteinte : ${MAX_PER_TYPE} ${type === "gif" ? "GIF" : "images"} maximum. Supprime-en un d'abord.`);

        settings.store.backgrounds = [...backgrounds, { url, type }];
        setInput("");
        select(url);
    }

    function remove(url: string) {
        settings.store.backgrounds = backgrounds.filter(b => b.url !== url);
        if (selected === url) select("");
    }

    return (
        <div className="omni-bg-manager">
            <Heading>Fond d'écran actif</Heading>
            <Select
                placeholder="Aucun fond"
                options={[
                    { label: "Aucun fond (Discord normal)", value: "" },
                    ...backgrounds.map(b => ({ label: labelOf(b, backgrounds), value: b.url }))
                ]}
                maxVisibleItems={8}
                closeOnSelect={true}
                select={select}
                isSelected={v => v === selected}
                serialize={v => String(v)}
            />

            <Heading>Ajouter une image ou un GIF</Heading>
            <Paragraph className="omni-bg-tip">
                ⚠️ Pour que tes images et GIF fonctionnent, héberge-les sur <Link href="https://catbox.moe/">catbox.moe</Link> :
                envoie ton fichier, puis colle ici le lien <b>files.catbox.moe/…</b> qu'il te donne.
            </Paragraph>
            <Paragraph>Images : {count("image")}/{MAX_PER_TYPE} · GIF : {count("gif")}/{MAX_PER_TYPE}</Paragraph>
            <div className="omni-bg-row omni-bg-add">
                <TextInput
                    value={input}
                    onChange={setInput}
                    placeholder="https://files.catbox.moe/..."
                />
                <Button size="small" disabled={busy || !input.trim()} onClick={add}>
                    {busy ? "…" : "Ajouter"}
                </Button>
            </div>
            {error && <Paragraph className="omni-bg-error">{error}</Paragraph>}

            {backgrounds.length > 0 && <Heading>Fonds enregistrés</Heading>}
            {backgrounds.map(b => (
                <div key={b.url} className="omni-bg-row omni-bg-item">
                    <img src={b.url} alt="" />
                    <span title={b.url}>{labelOf(b, backgrounds)}</span>
                    <Button size="small" variant="dangerSecondary" onClick={() => remove(b.url)}>Supprimer</Button>
                </div>
            ))}
        </div>
    );
}

const settings = definePluginSettings({
    manager: {
        type: OptionType.COMPONENT,
        component: BackgroundManager
    },
    backgrounds: {
        type: OptionType.CUSTOM,
        default: [] as SavedBackground[]
    },
    selected: {
        type: OptionType.CUSTOM,
        default: ""
    }
});

export default definePlugin({
    name: "OmniBackground",
    authors: [Devs.Exprimes],
    description: "Change le fond d'écran de Discord avec tes propres images et GIF (10 de chaque), enregistrés dans un menu déroulant.",
    tags: ["Appearance", "Customisation"],

    settings,

    start() {
        applyBackground();
    },

    stop() {
        removeBackground();
    }
});

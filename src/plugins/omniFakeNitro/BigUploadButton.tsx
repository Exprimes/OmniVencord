/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { insertTextIntoChatInputBox } from "@utils/discord";
import { IconComponent, PluginNative } from "@utils/types";
import { showToast, useState } from "@webpack/common";

const Native = VencordNative.pluginHelpers.OmniFakeNitro as PluginNative<typeof import("./native")>;

const LITTERBOX_MAX_SIZE = 1024 ** 3;
const MAX_SIZE = 3 * 1024 ** 3;

export const BigUploadIcon: IconComponent = ({ height = 20, width = 20, className }) => (
    <svg width={width} height={height} viewBox="0 0 24 24" className={className}>
        <path fill="currentColor" d="M12 2a1 1 0 0 1 .7.3l5 5a1 1 0 0 1-1.4 1.4L13 5.4V16a1 1 0 1 1-2 0V5.4L7.7 8.7a1 1 0 0 1-1.4-1.4l5-5A1 1 0 0 1 12 2ZM4 15a1 1 0 0 1 1 1v3h14v-3a1 1 0 1 1 2 0v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1Z" />
    </svg>
);

function formatSize(bytes: number) {
    return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} Go` : `${(bytes / 1024 ** 2).toFixed(1)} Mo`;
}

export function makeBigUploadButton(getTime: () => string): ChatBarButtonFactory {
    return ({ isMainChat }) => {
        const [busy, setBusy] = useState(false);
        if (!isMainChat) return null;

        async function onClick() {
            if (busy) return;
            const file = await Native.pickBigFile();
            if (!file) return;

            if (file.size > MAX_SIZE) {
                showToast({ text: `Fichier trop gros (${formatSize(file.size)}). Max 3 Go.`, variant: "critical" });
                return;
            }

            setBusy(true);
            showToast({ text: `Upload de ${file.name} (${formatSize(file.size)})...`, variant: "default" });
            try {
                const url = await Native.uploadPickedFile(getTime());
                insertTextIntoChatInputBox(url + " ");
                const kept = file.size > LITTERBOX_MAX_SIZE ? " Plus de 1 Go : le fichier reste 3 jours." : "";
                showToast({ text: `Upload terminé ! Lien ajouté au message.${kept}`, variant: "success" });
            } catch (e) {
                console.error("[OmniFakeNitro] Upload échoué", e);
                showToast({ text: `Échec de l'upload : ${(e as Error).message}`, variant: "critical" });
            } finally {
                setBusy(false);
            }
        }

        return (
            <ChatBarButton tooltip={busy ? "Upload en cours..." : "Envoyer un gros fichier (jusqu'à 3 Go)"} onClick={onClick}>
                <BigUploadIcon />
            </ChatBarButton>
        );
    };
}

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

const MAX_SIZE = 1024 * 1024 * 1024; // 1 Go (limite Litterbox)

export const BigUploadIcon: IconComponent = ({ height = 20, width = 20, className }) => (
    <svg width={width} height={height} viewBox="0 0 24 24" className={className}>
        <path fill="currentColor" d="M12 2a1 1 0 0 1 .7.3l5 5a1 1 0 0 1-1.4 1.4L13 5.4V16a1 1 0 1 1-2 0V5.4L7.7 8.7a1 1 0 0 1-1.4-1.4l5-5A1 1 0 0 1 12 2ZM4 15a1 1 0 0 1 1 1v3h14v-3a1 1 0 1 1 2 0v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1Z" />
    </svg>
);

function pickFile(): Promise<File | null> {
    return new Promise(resolve => {
        const input = document.createElement("input");
        input.type = "file";
        input.onchange = () => resolve(input.files?.[0] ?? null);
        input.click();
    });
}

function formatSize(bytes: number) {
    return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} Go` : `${(bytes / 1024 ** 2).toFixed(1)} Mo`;
}

export function makeBigUploadButton(getTime: () => string): ChatBarButtonFactory {
    return ({ isMainChat }) => {
        const [busy, setBusy] = useState(false);
        if (!isMainChat) return null;

        async function onClick() {
            if (busy) return;
            const file = await pickFile();
            if (!file) return;

            if (file.size > MAX_SIZE) {
                showToast({ text: `Fichier trop gros (${formatSize(file.size)}). Max 1 Go.`, variant: "critical" });
                return;
            }

            setBusy(true);
            showToast({ text: `Upload de ${file.name} (${formatSize(file.size)})...`, variant: "default" });
            try {
                const data = new Uint8Array(await file.arrayBuffer());
                const url = await Native.uploadToLitterbox(data, file.name, getTime());
                insertTextIntoChatInputBox(url + " ");
                showToast({ text: "Upload terminé ! Lien ajouté au message.", variant: "success" });
            } catch (e) {
                console.error("[OmniFakeNitro] Upload échoué", e);
                showToast({ text: "Échec de l'upload (voir console).", variant: "critical" });
            } finally {
                setBusy(false);
            }
        }

        return (
            <ChatBarButton tooltip={busy ? "Upload en cours..." : "Envoyer un gros fichier (jusqu'à 1 Go)"} onClick={onClick}>
                <BigUploadIcon />
            </ChatBarButton>
        );
    };
}

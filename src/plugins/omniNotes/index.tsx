/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import type { User } from "@vencord/discord-types";
import { ReactDOM, RestAPI, useEffect, useRef, useState } from "@webpack/common";

const PANEL_WIDTH = 240;
const GAP = 8;

const settings = definePluginSettings({
    showWhenEmpty: {
        displayName: "Afficher même sans note",
        description: "Affiche le panneau même quand tu n'as encore rien écrit sur la personne (pratique pour en ajouter une vite)",
        type: OptionType.BOOLEAN,
        default: true
    }
});

// Ce sont les notes natives de Discord (privées, synchronisées sur ton compte)
async function fetchNote(userId: string): Promise<string> {
    try {
        const { body } = await RestAPI.get({ url: `/users/@me/notes/${userId}` });
        return body?.note ?? "";
    } catch {
        return ""; // 404 = pas de note
    }
}

function saveNote(userId: string, note: string) {
    return RestAPI.put({ url: `/users/@me/notes/${userId}`, body: { note } });
}

function NotePanel({ user }: { user: User; }) {
    const anchorRef = useRef<HTMLSpanElement>(null);
    const [host, setHost] = useState<HTMLElement | null>(null);
    const [onLeft, setOnLeft] = useState(false);
    const [note, setNote] = useState<string | null>(null);
    const [status, setStatus] = useState("");
    const pending = useRef<string | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

    useEffect(() => {
        let alive = true;
        setNote(null);
        fetchNote(user.id).then(n => alive && setNote(n));
        return () => { alive = false; };
    }, [user.id]);

    // On se met dans le calque du popup (son parent) : un clic dans le panneau ne ferme pas le popup
    useEffect(() => {
        const popout = anchorRef.current?.closest<HTMLElement>('[class*="userPopoutOuter_"], [role="dialog"]');
        const layer = popout?.parentElement;
        if (!popout || !layer) return;

        const r = popout.getBoundingClientRect();
        setOnLeft(r.right + GAP + PANEL_WIDTH > window.innerWidth);
        setHost(layer);
    }, []);

    function flush() {
        clearTimeout(timer.current);
        if (pending.current == null) return;
        const value = pending.current;
        pending.current = null;
        setStatus("Enregistrement…");
        saveNote(user.id, value)
            .then(() => setStatus("Enregistré ✓"))
            .catch(() => setStatus("Échec de l'enregistrement"));
    }

    // Sauvegarde ce qui reste quand le popup se ferme
    useEffect(() => () => flush(), [user.id]);

    function onChange(value: string) {
        setNote(value);
        setStatus("");
        pending.current = value;
        clearTimeout(timer.current);
        timer.current = setTimeout(flush, 800);
    }

    const hidden = note === "" && !settings.store.showWhenEmpty;

    return (
        <>
            <span ref={anchorRef} hidden />
            {host && !hidden && ReactDOM.createPortal(
                <div
                    className="omni-notes-panel"
                    style={{ width: PANEL_WIDTH, [onLeft ? "right" : "left"]: `calc(100% + ${GAP}px)` }}
                >
                    <div className="omni-notes-title">📝 Note sur {user.globalName ?? user.username}</div>
                    {note === null
                        ? <div className="omni-notes-status">Chargement…</div>
                        : <textarea
                            className="omni-notes-input"
                            value={note}
                            maxLength={256}
                            placeholder="Clique pour ajouter une note"
                            onChange={e => onChange(e.currentTarget.value)}
                            onBlur={flush}
                        />}
                    <div className="omni-notes-status">{status || "Visible seulement par toi"}</div>
                </div>,
                host
            )}
        </>
    );
}

export default definePlugin({
    name: "OmniNotes",
    description: "Ouvre un panneau avec ta note sur la personne à côté de son profil quand tu cliques dessus.",
    authors: [Devs.Exprimes],
    tags: ["Friends", "Utility"],

    settings,

    patches: [
        {
            // Même point d'accroche que ReviewDB / ShowConnections
            find: '"UserProfilePopout");',
            replacement: {
                match: /user:(\i),widgets:.{0,100}?\}\),/,
                replace: "$&$self.renderNotePanel({user:$1}),"
            }
        }
    ],

    renderNotePanel: ErrorBoundary.wrap(NotePanel, { noop: true })
});

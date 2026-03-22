/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Notices } from "@api/index";
import { BaseText } from "@components/BaseText";
import { Button } from "@components/Button";
import { Link } from "@components/Link";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { findStoreLazy } from "@webpack";
import { Alerts, Toasts } from "@webpack/common";

const questScript = "https://raw.githubusercontent.com/Mr-PanoZzz/Quest_Completer_Vencord/refs/heads/main/questCompleterCode.js";
const QuestsStore = findStoreLazy("QuestStore");

export default definePlugin({
    name: "QuestCompleter",
    description: "Completes Quests (uses Aamia's quest script)",
    authors: [{ name: "Mr_PanoZzz", id: 939129546551210056n }],
    patches: [
        {
            find: "useMemo(()=>({sortMethod:",
            replacement: {
                match: /children:\[(.{0,30}optionClassName)/,
                replace: "children:[$self.CompleteQuestButton()(), $1"
            }
        }
    ],
    async completeQuest() {
        const possibleQuest = QuestsStore.quests.values().find(q => q.userStatus?.enrolledAt && !q.userStatus?.completedAt && new Date(q.config.expiresAt).getTime() > Date.now() && q.id !== "1412491570820812933");
        if (!possibleQuest) return Toasts.show({
            type: Toasts.Type.FAILURE,
            message: "You don't have any uncompleted quests",
            id: Toasts.genId()
        });

        Alerts.show({
            title: "Confirm",
            body: <BaseText>
                You are about to evaluate the script from <Link href={questScript}>this source</Link>, to complete the "{possibleQuest.config.messages.questName}" quest. You might want to review it. With that in mind, do you want to continue?
            </BaseText>,
            cancelText: "Cancel",
            confirmText: "OK",
            async onConfirm() {
                try {
                    const response = await fetch(questScript);
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    
                    const scriptContent = await response.text();
                    if (!scriptContent) throw new Error("Empty script received");

                    // For raw .js files, use content directly without markdown parsing
                    const wrappedScript = new Function("console", `return (() => { ${scriptContent} })();`);
                    
                    const console = {
                        log: (t: string) => {
                            if (t === "Quest completed!") {
                                return Notices.showNotice("Quest completed!", "OK", () => Notices.popNotice());
                            }
                            Toasts.show({
                                type: Toasts.Type.MESSAGE,
                                message: t,
                                id: Toasts.genId()
                            });
                            window.console.log(t);
                        }
                    };
                    
                    wrappedScript(console);
                } catch (err) {
                    Toasts.show({
                        type: Toasts.Type.FAILURE,
                        message: `Failed to execute quest script: ${err}`,
                        id: Toasts.genId()
                    });
                    console.error("[QuestCompleter] Error:", err);
                }
            }
        });
    },
    CompleteQuestButton() {
        return () => <Button size="small" onClick={() => this.completeQuest()}>
            Complete Recent Quest
        </Button>;
    }
});
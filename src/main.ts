import { RealtimeInteraction } from "./llm_interaction/RealtimeInteraction";

document.addEventListener("DOMContentLoaded", async () => {
    const realtimeInteraction = RealtimeInteraction.getInstance();
    realtimeInteraction.init();
});
import { RealtimeInteraction } from "./llm_interaction/RealtimeInteraction";
import { PositionView } from "./imageWithPosition/PositionView";

document.addEventListener("DOMContentLoaded", async () => {
    const realtimeInteraction = RealtimeInteraction.getInstance();
    realtimeInteraction.init();

    const positionView = PositionView.getInstance();
    positionView.init();
});
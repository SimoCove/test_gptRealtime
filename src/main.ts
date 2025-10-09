import { getEphemeralKey } from "./ephemeralKey/getEphemeralKey";
import { RealtimeInteraction } from "./llm_interaction/RealtimeInteraction";

document.addEventListener("DOMContentLoaded", async () => {
    const ephemeralKey = await getEphemeralKey();

    const realtimeInteraction = RealtimeInteraction.getInstance();
    realtimeInteraction.init(ephemeralKey);
});
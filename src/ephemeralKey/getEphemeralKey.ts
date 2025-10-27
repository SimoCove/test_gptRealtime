
function getEnvApiKey(): string | null {
    const key = (import.meta as any).env?.VITE_OPENAI_API_KEY;
    return typeof key === 'string' && key.length > 0 ? key : null;
}

export async function getEphemeralKey(): Promise<string | null> {
    const url = "https://api.openai.com/v1/realtime/client_secrets";
    const apiKey = getEnvApiKey();
    const llmModel = "gpt-realtime";

    try {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": 'Bearer ' + apiKey,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                session: {
                    type: "realtime",
                    model: llmModel,
                }
            })
        });

        if (!res.ok) throw new Error("HTTP error:" + res.status);
        const data = await res.json();
        if (!data.value) throw new Error("missing ephemeral key");
        return data.value;

    } catch (err) {
        console.error("Error obtaining ephemeral key:", err);
        return null;
    }
}
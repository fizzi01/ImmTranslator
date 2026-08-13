// Test del MicrosoftTranslator dopo il passaggio alla API pubblica
// https://edge.microsoft.com/translate/translatetext (nessun token di auth).
//
//   node --test test/*.test.mjs
//
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWorker, jsonResponse, edgeResponse } from "./worker-harness.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKER_JS = path.join(ROOT, "dist/translationWorker.js");
const MAIN_JS = path.join(ROOT, "dist/main.js");
const WORKERS = { dist: WORKER_JS };

const MS_CONFIG = { type: "Microsoft", apiKey: "", targetLang: "IT", callDelay: 0 };

async function initMicrosoft(workerPath, fetchImpl) {
    const w = createWorker(workerPath, fetchImpl);
    await w.send({ action: "init", config: MS_CONFIG });
    return w;
}

for (const [label, workerPath] of Object.entries(WORKERS)) {
    describe(`MicrosoftTranslator (${label})`, () => {
        test("si inizializza senza API key", async () => {
            const w = await initMicrosoft(workerPath, async () => jsonResponse([]));
            assert.deepEqual(
                w.messages.filter(m => m.status),
                [{ status: "initialized" }]
            );
        });

        test("translate: chiama l'endpoint pubblico senza header di auth", async () => {
            const w = await initMicrosoft(workerPath, async () =>
                jsonResponse(edgeResponse(["  Ciao mondo  "]))
            );

            w.send({ action: "translateText", text: "Hello world", requestId: "r1" });
            const msg = await w.nextMessage(m => m.requestId === "r1");

            assert.equal(msg.status, "success");
            assert.equal(msg.translation, "Ciao mondo", "il testo va trimmato");

            assert.equal(w.calls.length, 1);
            const { url, options } = w.calls[0];
            assert.equal(
                url,
                "https://edge.microsoft.com/translate/translatetext?from=&to=IT"
            );
            assert.equal(options.method, "POST");
            assert.deepEqual(JSON.parse(options.body), ["Hello world"]);
            const headerNames = Object.keys(options.headers).map(h => h.toLowerCase());
            assert.ok(!headerNames.includes("authorization"), "nessun Bearer token");
            assert.ok(!headerNames.some(h => h.startsWith("ocp-apim")), "nessuna key Azure");
        });

        test("translate: propaga l'errore se la risposta non ha traduzioni", async () => {
            const w = await initMicrosoft(workerPath, async () => jsonResponse([{}]));

            w.send({ action: "translateText", text: "Hello", requestId: "r2" });
            const msg = await w.nextMessage(m => m.requestId === "r2");

            assert.equal(msg.status, "error");
            assert.match(msg.error, /No translation received from Microsoft/);
        });

        test("translateBatch: manda un array di stringhe e mappa per indice", async () => {
            const w = await initMicrosoft(workerPath, async () =>
                jsonResponse(edgeResponse(["Uno", "Due", "Tre"]))
            );

            const items = [
                { id: "a", index: 0, content: "One" },
                { id: "b", index: 1, content: "Two" },
                { id: "c", index: 2, content: "Three" }
            ];
            w.send({
                action: "translateBatch",
                batchPayload: { id: "batch-1", items },
                requestId: "b1"
            });
            const msg = await w.nextMessage(m => m.requestId === "b1");

            assert.equal(msg.status, "success");
            assert.equal(w.calls.length, 1, "una sola richiesta per tutto il batch");
            assert.deepEqual(
                JSON.parse(w.calls[0].options.body),
                ["One", "Two", "Three"],
                "body = array di stringhe, non [{Text: ...}]"
            );
            assert.deepEqual(
                msg.translation.map(r => [r.id, r.index, r.originalText, r.translatedText, r.success]),
                [
                    ["a", 0, "One", "Uno", true],
                    ["b", 1, "Two", "Due", true],
                    ["c", 2, "Three", "Tre", true]
                ]
            );
        });

        test("translateBatch: entry mancante -> success false su quell'item", async () => {
            const w = await initMicrosoft(workerPath, async () =>
                jsonResponse([edgeResponse(["Uno"])[0], {}])
            );

            w.send({
                action: "translateBatch",
                batchPayload: {
                    id: "batch-2",
                    items: [
                        { id: "a", index: 0, content: "One" },
                        { id: "b", index: 1, content: "Two" }
                    ]
                },
                requestId: "b2"
            });
            const msg = await w.nextMessage(m => m.requestId === "b2");

            assert.equal(msg.translation[0].success, true);
            assert.equal(msg.translation[1].success, false);
            assert.equal(msg.translation[1].translatedText, null);
            assert.equal(msg.translation[1].error, "No translation received");
        });

        test("translateBatch: risposta non valida -> fallback item per item", async () => {
            let call = 0;
            const w = await initMicrosoft(workerPath, async () => {
                call++;
                // la prima chiamata (batch) risponde con un formato non valido
                if (call === 1) return jsonResponse({ error: "nope" });
                return jsonResponse(edgeResponse([`T${call - 1}`]));
            });

            w.send({
                action: "translateBatch",
                batchPayload: {
                    id: "batch-3",
                    items: [
                        { id: "a", index: 0, content: "One" },
                        { id: "b", index: 1, content: "Two" }
                    ]
                },
                requestId: "b3"
            });
            const msg = await w.nextMessage(m => m.requestId === "b3");

            assert.equal(msg.status, "success");
            assert.equal(w.calls.length, 3, "1 batch fallito + 2 traduzioni singole");
            assert.deepEqual(
                msg.translation.map(r => r.translatedText),
                ["T1", "T2"]
            );
        });
    });
}

describe("rimozione del meccanismo di auth", () => {
    const sources = { ...WORKERS, main: MAIN_JS };

    for (const [label, file] of Object.entries(sources)) {
        test(`${label}: nessun riferimento all'endpoint di auth o alle API Azure`, () => {
            const code = fs.readFileSync(file, "utf8");
            assert.ok(!code.includes("translate/auth"), "edge.microsoft.com/translate/auth");
            assert.ok(!code.includes("getAzureAuthKey"), "getAzureAuthKey");
            assert.ok(
                !code.includes("api-edge.cognitive.microsofttranslator.com"),
                "endpoint Azure api-edge"
            );
        });
    }
});

// Test contro il servizio reale: opt-in con LIVE=1 (richiede rete).
describe("API pubblica Edge (live)", { skip: !process.env.LIVE }, () => {
    test("traduce senza autenticazione", async () => {
        const res = await fetch(
            "https://edge.microsoft.com/translate/translatetext?from=&to=it",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(["Hello world"])
            }
        );
        assert.equal(res.ok, true, `status ${res.status}`);
        const data = await res.json();
        assert.ok(Array.isArray(data) && data[0]?.translations?.[0]?.text);
    });
});

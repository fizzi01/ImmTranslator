// Carica il body di workerCore() da un file translationWorker.js e lo esegue
// in un finto ambiente Worker, con fetch/navigator iniettati come parametri
// (così non serve toccare i globali di Node).
import fs from "node:fs";

const START = "function workerCore()";
const END = "const codeStr = workerCore.toString()";

function extractWorkerBody(filePath) {
    const src = fs.readFileSync(filePath, "utf8");
    const start = src.indexOf(START);
    const end = src.indexOf(END);
    if (start < 0 || end < 0) throw new Error(`Struttura inattesa in ${filePath}`);
    // stessa estrazione che fa l'app: dal primo "{" all'ultimo "}" di workerCore
    const region = src.slice(start, end);
    return region.substring(region.indexOf("{") + 1, region.lastIndexOf("}"));
}

/**
 * Istanzia il worker.
 * @param {string} filePath  percorso di translationWorker.js
 * @param {(url: string, options: object) => Promise<any>} fetchImpl  mock di fetch
 * @returns {{send: Function, messages: object[], calls: object[], nextMessage: Function}}
 */
export function createWorker(filePath, fetchImpl) {
    const body = extractWorkerBody(filePath);
    const messages = [];
    const calls = [];
    let waiter = null;

    const self = {
        onmessage: null,
        postMessage(data) {
            messages.push(data);
            if (waiter) {
                const resolve = waiter;
                waiter = null;
                resolve(data);
            }
        },
        addEventListener() {},
        removeEventListener() {}
    };

    const fetch = async (url, options) => {
        calls.push({ url, options });
        return fetchImpl(url, options);
    };

    // eslint-disable-next-line no-new-func
    const run = new Function("self", "postMessage", "navigator", "fetch", body);
    run(self, self.postMessage.bind(self), { onLine: true }, fetch);

    return {
        messages,
        calls,
        send(data) {
            return self.onmessage({ data });
        },
        // attende il prossimo postMessage con lo status richiesto
        nextMessage(predicate = () => true, timeoutMs = 5000) {
            const found = messages.find(predicate);
            if (found) return Promise.resolve(found);
            return new Promise((resolve, reject) => {
                const timer = setTimeout(
                    () => reject(new Error("timeout in attesa del messaggio dal worker")),
                    timeoutMs
                );
                const check = data => {
                    if (predicate(data)) {
                        clearTimeout(timer);
                        resolve(data);
                    } else {
                        waiter = check;
                    }
                };
                waiter = check;
            });
        }
    };
}

export function jsonResponse(payload) {
    return { ok: true, status: 200, json: async () => payload };
}

/** Risposta nel formato della API pubblica Edge, una entry per testo. */
export function edgeResponse(texts, to = "it") {
    return texts.map(text => ({
        detectedLanguage: { language: "en", score: 1 },
        translations: [{ text, to }]
    }));
}

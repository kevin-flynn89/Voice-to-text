
import { pipeline, env } from "@huggingface/transformers";
import "./style.css";

env.allowLocalModels = false;
env.useBrowserCache = true;

const $ = (selector) => document.querySelector(selector);

const SHARE_CACHE = "voicetotext-share-v2";
let asr = null;
let llm = null;
let busy = false;
let activeModel = null;

function render() {
  $("#app").innerHTML = `
    <header class="header">
      <div>
        <div class="brand">
          <img class="logo" src="./icon.svg" alt="">
          VoiceToText
        </div>
        <span class="muted">AI locale</span>
      </div>
    </header>

    <main class="main">
      <section class="hero">
        <h1>Trascrivi i tuoi vocali.</h1>
        <p class="muted">
          Condividi un audio da WhatsApp oppure selezionalo qui.
          L'elaborazione avviene sul dispositivo.
        </p>
      </section>

      <section class="card">
        <div id="drop" class="drop">
          <b>Trascina qui un audio</b>
          <p class="muted">oppure scegli un file</p>
          <button id="pick" class="btn primary">Scegli audio</button>
          <input
            id="file"
            class="hidden"
            type="file"
            accept="audio/*,.ogg,.opus,.m4a,.mp3,.wav,.aac"
          >
        </div>

        <div id="status" class="status" role="status" aria-live="polite">
          Pronto.
        </div>

        <div class="progress">
          <div id="bar"></div>
        </div>
      </section>

      <section id="result" class="card hidden"></section>

      <section class="card">
        <b>Modello Whisper</b>
        <select
          id="model"
          style="display:block;margin-top:8px;padding:10px;border:1px solid #cbd5e1;border-radius:10px"
        >
          <option value="onnx-community/whisper-tiny">
            Tiny — più leggero
          </option>
          <option value="onnx-community/whisper-base">
            Base — più accurato
          </option>
        </select>
        <p class="muted">
          WebGPU viene usato quando disponibile, con ripiego su WASM.
        </p>
      </section>

      <section class="card">
        <b>Privacy</b>
        <p class="muted">
          Nessuna API key e nessun backend VoiceToText.
          I modelli vengono scaricati al primo utilizzo e messi in cache.
        </p>
      </section>
    </main>
  `;

  $("#pick").onclick = () => $("#file").click();

  $("#file").onchange = (event) => {
    const file = event.target.files?.[0];
    if (file) process(file);
    event.target.value = "";
  };

  const drop = $("#drop");

  drop.ondragover = (event) => {
    event.preventDefault();
  };

  drop.ondrop = (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file) process(file);
  };

  $("#model").onchange = () => {
    asr = null;
    activeModel = null;
  };

  loadShared();
}

function stat(message, progress = null) {
  const status = $("#status");
  const bar = $("#bar");

  if (status) status.textContent = message;

  if (progress !== null && bar) {
    bar.style.width = `${Math.max(0, Math.min(100, progress))}%`;
  }
}

async function decode(file) {
  const AudioContextClass =
    window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) {
    throw new Error("Il browser non supporta la decodifica audio richiesta.");
  }

  const context = new AudioContextClass();

  try {
    const audioBuffer = await context.decodeAudioData(
      await file.arrayBuffer()
    );

    const sampleRate = 16000;

    const offlineContext = new OfflineAudioContext(
      1,
      Math.ceil(audioBuffer.duration * sampleRate),
      sampleRate
    );

    const source = offlineContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineContext.destination);
    source.start();

    const rendered = await offlineContext.startRendering();

    return rendered.getChannelData(0);
  } finally {
    await context.close().catch(() => {});
  }
}

async function createPipeline(task, model, dtype) {
  const options = {
    dtype,
    device: "webgpu"
  };

  try {
    stat("Caricamento modello con WebGPU…", 15);
    return await pipeline(task, model, options);
  } catch (webgpuError) {
    console.warn("WebGPU non disponibile, provo WASM:", webgpuError);

    stat("WebGPU non disponibile. Provo la modalità compatibile…", 20);

    return await pipeline(task, model, {
      dtype: "q8",
      device: "wasm"
    });
  }
}

async function getASR() {
  const model = $("#model").value;

  if (asr && activeModel === model) {
    return asr;
  }

  asr = null;
  activeModel = model;

  asr = await createPipeline(
    "automatic-speech-recognition",
    model,
    "fp32"
  );

  return asr;
}

async function getLLM() {
  if (llm) return llm;

  llm = await createPipeline(
    "text-generation",
    "onnx-community/Qwen2.5-0.5B-Instruct",
    "q4"
  );

  return llm;
}

async function process(file) {
  if (busy) {
    stat("Attendi che termini l'elaborazione in corso.");
    return;
  }

  if (!file || file.size === 0) {
    stat("Il file audio è vuoto o non valido.");
    return;
  }

  busy = true;

  const fileInput = $("#file");
  if (fileInput) fileInput.disabled = true;

  try {
    stat("Preparo l'audio…", 5);

    const audio = await decode(file);

    stat("Trascrizione in corso…", 30);

    const transcriber = await getASR();

    const result = await transcriber(audio, {
      language: "italian",
      task: "transcribe",
      chunk_length_s: 30,
      stride_length_s: 5
    });

    const transcript = (result.text || "").trim();

    if (!transcript) {
      throw new Error(
        "Non è stato riconosciuto testo. Prova con un altro audio."
      );
    }

    let summary = "";

    try {
      stat("Creo il riepilogo TL;DR…", 75);

      const summarizer = await getLLM();

      const prompt =
        "Riassumi in italiano il seguente messaggio vocale in massimo 3 frasi. " +
        "Conserva solo le informazioni importanti. Non inventare dettagli.\n\n" +
        "TESTO:\n" +
        transcript;

      const output = await summarizer(prompt, {
        max_new_tokens: 120,
        temperature: 0.2,
        do_sample: false
      });

      summary = (output[0]?.generated_text || "")
        .replace(prompt, "")
        .trim();

      if (!summary) {
        summary = "Riepilogo non disponibile.";
      }
    } catch (error) {
      console.warn("Riepilogo non disponibile:", error);
      summary = "TL;DR non disponibile su questo dispositivo.";
    }

    show(transcript, summary);
    stat("Completato. Elaborazione locale.", 100);
  } catch (error) {
    console.error("Errore durante l'elaborazione:", error);

    stat(
      "Impossibile elaborare l'audio: " +
        (error?.message || String(error)),
      0
    );
  } finally {
    busy = false;

    if (fileInput) fileInput.disabled = false;
  }
}

function show(transcript, summary) {
  const result = $("#result");

  result.classList.remove("hidden");

  result.innerHTML = `
    <h2>Trascrizione</h2>

    <textarea
      id="txt"
      aria-label="Testo della trascrizione"
    ></textarea>

    <div class="actions">
      <button id="copy" class="btn secondary">
        Copia trascrizione
      </button>

      <button id="share" class="btn secondary">
        Condividi
      </button>
    </div>

    <div class="tldr">
      <h2>TL;DR</h2>
      <div id="sum" class="text"></div>
    </div>

    <div class="actions">
      <button id="all" class="btn primary">
        Copia tutto
      </button>

      <button id="save" class="btn ghost">
        Salva
      </button>
    </div>
  `;

  $("#txt").value = transcript;
  $("#sum").textContent =
    summary || "TL;DR non disponibile su questo dispositivo.";

  $("#copy").onclick = async () => {
    await copyText($("#txt").value);
    stat("Trascrizione copiata.", 100);
  };

  $("#all").onclick = async () => {
    const text =
      $("#txt").value +
      "\n\nTL;DR\n" +
      $("#sum").textContent;

    await copyText(text);
    stat("Trascrizione e riepilogo copiati.", 100);
  };

  $("#save").onclick = () => {
    try {
      const historyItems = JSON.parse(
        localStorage.getItem("vtt-history") || "[]"
      );

      historyItems.unshift({
        date: new Date().toISOString(),
        transcript: $("#txt").value,
        summary: $("#sum").textContent
      });

      localStorage.setItem(
        "vtt-history",
        JSON.stringify(historyItems.slice(0, 20))
      );

      stat("Salvato nella cronologia locale.", 100);
    } catch (error) {
      console.error(error);
      stat("Impossibile salvare nella cronologia locale.", 0);
    }
  };

  $("#share").onclick = async () => {
    const text =
      $("#txt").value +
      "\n\nTL;DR\n" +
      $("#sum").textContent;

    try {
      if (navigator.share) {
        await navigator.share({
          title: "VoiceToText",
          text
        });
      } else {
        await copyText(text);
        stat("Testo copiato: puoi incollarlo dove vuoi.", 100);
      }
    } catch (error) {
      if (error?.name !== "AbortError") {
        console.error(error);
        stat("Impossibile condividere il testo.", 0);
      }
    }
  };
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";

  document.body.appendChild(textarea);
  textarea.select();

  const copied = document.execCommand("copy");
  textarea.remove();

  if (!copied) {
    throw new Error("Copia negli appunti non riuscita.");
  }
}

async function loadShared() {
  const params = new URLSearchParams(location.search);

  if (params.has("share-error")) {
    history.replaceState({}, "", location.pathname);
    stat("Non è stato possibile ricevere l'audio. Riprova.", 0);
    return;
  }

  if (params.get("shared") !== "1") return;

  try {
    if (!("caches" in window)) {
      throw new Error("La cache del browser non è disponibile.");
    }

    const cache = await caches.open(SHARE_CACHE);

    const audioUrl = new URL(
      "shared-audio",
      document.baseURI
    ).href;

    const response = await cache.match(audioUrl);

    if (!response) {
      stat(
        "Audio condiviso non trovato. Prova a condividerlo di nuovo.",
        0
      );
      return;
    }

    const blob = await response.blob();

    const encodedFilename =
      response.headers.get("X-VoiceToText-Filename") || "audio";

    let filename = "audio";

    try {
      filename = decodeURIComponent(encodedFilename);
    } catch {
      filename = "audio";
    }

    await cache.delete(audioUrl);

    history.replaceState({}, "", location.pathname);

    await process(
      new File([blob], filename, {
        type: blob.type || "audio/ogg"
      })
    );
  } catch (error) {
    console.error("Errore nel recupero dell'audio condiviso:", error);

    history.replaceState({}, "", location.pathname);

    stat(
      "Errore nella ricezione dell'audio condiviso. Riprova.",
      0
    );
  }
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("./sw.js");
      console.log("Service worker registrato.");
    } catch (error) {
      console.error("Registrazione service worker fallita:", error);
    }
  });
}

render();

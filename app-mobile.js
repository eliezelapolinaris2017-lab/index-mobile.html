import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  collection,
  getDocs,
  query,
  orderBy,
  serverTimestamp,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyBm67RjL0QzMRLfo6zUYCI0bak1eGJAR-U",
  authDomain: "oasis-facturacion.firebaseapp.com",
  projectId: "oasis-facturacion",
  storageBucket: "oasis-facturacion.firebasestorage.app",
  messagingSenderId: "84422038905",
  appId: "1:84422038905:web:b0eef65217d2bfc3298ba8"
};

const FB_APP = initializeApp(firebaseConfig);
const auth = getAuth(FB_APP);
const db = getFirestore(FB_APP);
const storage = getStorage(FB_APP);

const $ = (id) => document.getElementById(id);

const fmtMoney = (n) => {
  const x = Number(n || 0);
  return x.toLocaleString("en-US", { style: "currency", currency: "USD" });
};

const toISODate = (d) => {
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

function uid(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function blobToDataUrl(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

async function fileToDataUrl(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

async function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

async function normalizeLogoFileForPdf(file) {
  const img = await fileToImage(file);

  const maxSize = 600;
  let { width, height } = img;

  if (width > height) {
    if (width > maxSize) {
      height = Math.round((height * maxSize) / width);
      width = maxSize;
    }
  } else {
    if (height > maxSize) {
      width = Math.round((width * maxSize) / height);
      height = maxSize;
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  return canvas.toDataURL("image/png");
}

function userBase(uid_) {
  return `users/${uid_}`;
}
function colDocs(uid_) {
  return collection(db, `${userBase(uid_)}/docs`);
}
function colCustomers(uid_) {
  return collection(db, `${userBase(uid_)}/customers`);
}
function docSettings(uid_) {
  return doc(db, `${userBase(uid_)}/settings/main`);
}

let state = {
  user: null,
  view: "home",
  activeDocId: null,
  current: null,
  previewBlobUrl: null,
  docs: [],
  customers: [],
  cfg: null,
  customerFormOpen: false,
  catalogIndex: { catById: new Map(), svcById: new Map() }
};

function defaultCatalog() {
  return {
    categories: [
      {
        id: "cat_mant",
        name: "Mantenimiento",
        services: [
          {
            id: "svc_mant_res",
            name: "Mantenimiento Preventivo Mini Split",
            desc: "Servicio preventivo: limpieza, revisión eléctrica, drenajes y prueba operacional.",
            price: 55,
            notes: "Incluye 1 unidad. Precio sujeto a acceso y condición.",
            warranty: "Garantía de servicio: 30 días en mano de obra.",
            terms: "Depósito no reembolsable si aplica y no hay acceso o respuesta."
          }
        ]
      },
      {
        id: "cat_diag",
        name: "Diagnóstico",
        services: [
          {
            id: "svc_diag_bas",
            name: "Diagnóstico Técnico",
            desc: "Evaluación técnica y recomendación de reparación.",
            price: 45,
            notes: "Diagnóstico no incluye reparación ni piezas.",
            warranty: "Garantía aplica solo a reparación realizada.",
            terms: "El diagnóstico se acredita si se aprueba la reparación el mismo día."
          }
        ]
      }
    ]
  };
}

function defaultTemplates() {
  return {
    notes: [
      { id: "nt_std", name: "Nota estándar", text: "Gracias por preferirnos. Trabajo realizado según inspección en sitio." }
    ],
    warranties: [
      { id: "w_30", name: "Garantía 30 días", text: "Garantía de 30 días en mano de obra. No cubre mal uso ni terceros." }
    ],
    terms: [
      { id: "t_std", name: "Términos estándar", text: "Pago contra entrega. IVU aplicado según ley." }
    ]
  };
}

function defaultCfg() {
  return {
    biz: {
      name: "Oasis Air Cleaner Services LLC",
      phone: "787-664-3079",
      email: "",
      addr: "Puerto Rico",
      logoUrl: "",
      logoDataUrl: ""
    },
    taxRate: 11.5,
    catalog: defaultCatalog(),
    templates: defaultTemplates()
  };
}

function normalizeCfg(cfg) {
  const base = defaultCfg();
  const merged = { ...base, ...(cfg || {}) };

  merged.biz = { ...base.biz, ...(cfg?.biz || {}) };
  merged.catalog = cfg?.catalog?.categories ? cfg.catalog : base.catalog;
  merged.templates = cfg?.templates
    ? {
        notes: Array.isArray(cfg.templates.notes) ? cfg.templates.notes : base.templates.notes,
        warranties: Array.isArray(cfg.templates.warranties) ? cfg.templates.warranties : base.templates.warranties,
        terms: Array.isArray(cfg.templates.terms) ? cfg.templates.terms : base.templates.terms
      }
    : base.templates;

  merged.catalog.categories = (merged.catalog.categories || []).map((c) => ({
    id: String(c.id || uid("cat")),
    name: String(c.name || "Categoría"),
    services: (c.services || []).map((s) => ({
      id: String(s.id || uid("svc")),
      name: String(s.name || "Servicio"),
      desc: String(s.desc || ""),
      price: Number(s.price || 0),
      notes: String(s.notes || ""),
      warranty: String(s.warranty || ""),
      terms: String(s.terms || "")
    }))
  }));

  return merged;
}

function indexCatalog() {
  state.catalogIndex.catById = new Map();
  state.catalogIndex.svcById = new Map();

  const cats = state.cfg?.catalog?.categories || [];
  cats.forEach((c) => {
    state.catalogIndex.catById.set(c.id, c);
    (c.services || []).forEach((s) => state.catalogIndex.svcById.set(s.id, { ...s, _catId: c.id }));
  });
}

function newDoc(type = "COT") {
  const cfg = state.cfg || defaultCfg();
  const today = toISODate(new Date());
  const valid = toISODate(new Date(Date.now() + 14 * 24 * 3600 * 1000));

  return {
    id: uid("doc"),
    type,
    number: "",
    date: today,
    status: "PENDIENTE",
    client: { name: "", contact: "", addr: "" },
    validUntil: valid,
    items: [{ id: uid("it"), desc: "", qty: 1, price: 0, catId: "", svcId: "" }],
    notes: "",
    terms: "",
    totals: { sub: 0, tax: 0, grand: 0 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    taxRate: Number(cfg.taxRate || 11.5)
  };
}

function ensureAuthButtons() {
  const wrap = document.querySelector(".mobileTopActions");
  if (!wrap) return;

  if (!$("btnLogin")) {
    const b = document.createElement("button");
    b.className = "iconBtn";
    b.id = "btnLogin";
    b.type = "button";
    b.title = "Login";
    b.textContent = "↗";
    wrap.prepend(b);
  }

  if (!$("btnLogout")) {
    const b = document.createElement("button");
    b.className = "iconBtn";
    b.id = "btnLogout";
    b.type = "button";
    b.title = "Logout";
    b.textContent = "⎋";
    wrap.prepend(b);
  }

  $("btnLogin").onclick = login;
  $("btnLogout").onclick = logout;
  refreshAuthUI();
}

function refreshAuthUI() {
  const isOn = !!state.user;
  if ($("btnLogin")) $("btnLogin").style.display = isOn ? "none" : "grid";
  if ($("btnLogout")) $("btnLogout").style.display = isOn ? "grid" : "none";

  [
    "btnSaveDoc",
    "btnPDF",
    "btnConfirmFromPreview",
    "btnExportHist",
    "btnClearHist",
    "btnAddCustomer",
    "btnExportBackup",
    "btnRestoreBackup"
  ].forEach((id) => {
    if ($(id)) $(id).disabled = !isOn;
  });
}

async function login() {
  const provider = new GoogleAuthProvider();
  await signInWithPopup(auth, provider);
}

async function logout() {
  await signOut(auth);
}

async function loadAllFromFirestore() {
  if (!state.user) return;

  const sref = docSettings(state.user.uid);
  const snap = await getDoc(sref);
  state.cfg = snap.exists() ? normalizeCfg(snap.data()) : normalizeCfg(defaultCfg());

  indexCatalog();

  const qDocs = query(colDocs(state.user.uid), orderBy("updatedAt", "desc"));
  const docsSnap = await getDocs(qDocs);
  state.docs = docsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const qCus = query(colCustomers(state.user.uid), orderBy("createdAt", "desc"));
  const cusSnap = await getDocs(qCus);
  state.customers = cusSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  refreshKPIs();
  renderLastTransactions();
  renderHistory();
  renderCustomers();
  renderReporting();
  syncFormFromState();
  renderItemsMobile();
}

async function saveSettingsToFirestore() {
  if (!state.user) return;
  const sref = docSettings(state.user.uid);
  const safeCfg = JSON.parse(JSON.stringify(normalizeCfg(state.cfg || defaultCfg())));

  await setDoc(
    sref,
    {
      ...safeCfg,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
}

async function buildBackupPayload() {
  return {
    exportedAt: new Date().toISOString(),
    version: "nexus_invoicing_mobile_backup_local_v1",
    docs: Array.isArray(state.docs) ? state.docs : [],
    customers: Array.isArray(state.customers) ? state.customers : [],
    cfg: state.cfg ? JSON.parse(JSON.stringify(state.cfg)) : defaultCfg()
  };
}

async function exportBackupFile() {
  const payload = await buildBackupPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `nexus_invoicing_mobile_backup_${toISODate(new Date())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 800);
}

async function restoreBackupFromFile(file) {
  if (!state.user) return alert("Login requerido.");

  const txt = await file.text();
  const parsed = JSON.parse(txt);

  if (!parsed || parsed.version !== "nexus_invoicing_mobile_backup_local_v1") {
    throw new Error("Archivo de backup inválido.");
  }

  const docsArr = Array.isArray(parsed.docs) ? parsed.docs : [];
  const customersArr = Array.isArray(parsed.customers) ? parsed.customers : [];
  const cfgObj = normalizeCfg(parsed.cfg || defaultCfg());

  state.cfg = cfgObj;
  await saveSettingsToFirestore();

  for (const c of customersArr) {
    const cid = c.id || uid("cus");
    await setDoc(doc(db, `${userBase(state.user.uid)}/customers/${cid}`), {
      ...c,
      restoredAt: serverTimestamp()
    }, { merge: true });
  }

  for (const d of docsArr) {
    const did = d.id || uid("doc");
    await setDoc(doc(db, `${userBase(state.user.uid)}/docs/${did}`), {
      ...d,
      restoredAt: serverTimestamp()
    }, { merge: true });
  }

  await loadAllFromFirestore();
  alert("Backup restaurado ✅");
}

function setView(view) {
  state.view = view;

  document.querySelectorAll(".view").forEach((v) => v.classList.remove("is-active"));
  $(`view-${view}`)?.classList.add("is-active");

  document.querySelectorAll(".bottomLink").forEach((b) => b.classList.remove("is-active"));
  document.querySelectorAll(`.bottomLink[data-view="${view}"]`).forEach((b) => b.classList.add("is-active"));

  if (view === "home") {
    refreshKPIs();
    renderLastTransactions();
  }
  if (view === "invoicing") renderInvoicing();
  if (view === "customers") renderCustomers();
  if (view === "history") renderHistory();
  if (view === "reporting") renderReporting();
}

function syncFormFromState() {
  if (!state.current) return;

  if ($("docType")) $("docType").value = state.current.type;
  if ($("docNumber")) $("docNumber").value = state.current.number || "";
  if ($("docDate")) $("docDate").value = state.current.date || toISODate(new Date());
  if ($("docStatus")) $("docStatus").value = state.current.status || "PENDIENTE";

  if ($("clientName")) $("clientName").value = state.current.client?.name || "";
  if ($("clientContact")) $("clientContact").value = state.current.client?.contact || "";
  if ($("clientAddr")) $("clientAddr").value = state.current.client?.addr || "";
  if ($("validUntil")) $("validUntil").value = state.current.validUntil || "";
  if ($("notes")) $("notes").value = state.current.notes || "";
  if ($("terms")) $("terms").value = state.current.terms || "";

  if ($("docModePill")) $("docModePill").textContent = state.activeDocId ? "Editando" : "Nuevo";
}

function readDocHeaderIntoState() {
  if (!state.current) return;

  state.current.type = $("docType")?.value || "COT";
  state.current.number = ($("docNumber")?.value || "").trim();
  state.current.date = $("docDate")?.value || toISODate(new Date());
  state.current.status = $("docStatus")?.value || "PENDIENTE";
  state.current.client.name = ($("clientName")?.value || "").trim();
  state.current.client.contact = ($("clientContact")?.value || "").trim();
  state.current.client.addr = ($("clientAddr")?.value || "").trim();
  state.current.validUntil = $("validUntil")?.value || "";
  state.current.notes = ($("notes")?.value || "").trim();
  state.current.terms = ($("terms")?.value || "").trim();
}

function buildServiceOptions(catId = "", selectedSvc = "") {
  const cat = state.catalogIndex.catById.get(catId);
  const list = cat?.services || [];
  let html = `<option value="">Servicio</option>`;
  list.forEach((svc) => {
    html += `<option value="${escapeHtml(svc.id)}" ${svc.id === selectedSvc ? "selected" : ""}>${escapeHtml(svc.name)}</option>`;
  });
  return html;
}

function buildCategoryOptions(selectedCat = "") {
  const cats = state.cfg?.catalog?.categories || [];
  let html = `<option value="">Categoría</option>`;
  cats.forEach((cat) => {
    html += `<option value="${escapeHtml(cat.id)}" ${cat.id === selectedCat ? "selected" : ""}>${escapeHtml(cat.name)}</option>`;
  });
  return html;
}

function renderItemsMobile() {
  const wrap = $("items");
  if (!wrap || !state.current) return;

  wrap.innerHTML = "";

  const items = state.current.items || [];
  if (!items.length) {
    wrap.innerHTML = `<div class="listCard"><div class="listTitle">Sin items</div><div class="listSub">Añade una línea para comenzar.</div></div>`;
    return;
  }

  items.forEach((it) => {
    const total = Number(it.qty || 0) * Number(it.price || 0);

    const card = document.createElement("article");
    card.className = "mobileItemCard";
    card.dataset.itemId = it.id;
    card.innerHTML = `
      <div class="mobileItemGrid">
        <div class="itemRow2">
          <div class="field">
            <label>Categoría</label>
            <select class="input item-cat">${buildCategoryOptions(it.catId || "")}</select>
          </div>
          <div class="field">
            <label>Servicio</label>
            <select class="input item-svc">${buildServiceOptions(it.catId || "", it.svcId || "")}</select>
          </div>
        </div>

        <div class="field">
          <label>Descripción</label>
          <input class="input item-desc" value="${escapeHtml(it.desc || "")}" placeholder="Descripción" />
        </div>

        <div class="itemRow2">
          <div class="field">
            <label>Cantidad</label>
            <input class="input item-qty" type="number" min="0" step="1" value="${Number(it.qty ?? 1)}" />
          </div>
          <div class="field">
            <label>Precio</label>
            <input class="input item-price" type="number" inputmode="decimal" min="0" step="0.01" value="${Number(it.price ?? 0)}" />
          </div>
        </div>

        <div class="itemTotal">
          <span>Total</span>
          <strong class="item-total-value">${fmtMoney(total)}</strong>
        </div>

        <button class="itemDelete" type="button">Eliminar item</button>
      </div>
    `;

    const catSel = card.querySelector(".item-cat");
    const svcSel = card.querySelector(".item-svc");
    const descInput = card.querySelector(".item-desc");
    const qtyInput = card.querySelector(".item-qty");
    const priceInput = card.querySelector(".item-price");
    const totalLabel = card.querySelector(".item-total-value");
    const delBtn = card.querySelector(".itemDelete");

    const refreshRowTotal = () => {
      totalLabel.textContent = fmtMoney(Number(it.qty || 0) * Number(it.price || 0));
    };

    catSel.addEventListener("change", () => {
      it.catId = catSel.value || "";
      it.svcId = "";
      svcSel.innerHTML = buildServiceOptions(it.catId, "");
      updateTotalsLive();
      refreshRowTotal();
    });

    svcSel.addEventListener("change", () => {
      it.svcId = svcSel.value || "";
      if (!it.svcId) return;

      const svc = state.catalogIndex.svcById.get(it.svcId);
      if (!svc) return;

      it.desc = svc.desc || svc.name || "";
      it.price = Number(svc.price || 0);

      descInput.value = it.desc;
      priceInput.value = String(it.price);

      if ((!state.current.notes || !state.current.notes.trim()) && svc.notes) {
        state.current.notes = svc.notes;
        if ($("notes")) $("notes").value = svc.notes;
      }

      if ((!state.current.terms || !state.current.terms.trim()) && svc.terms) {
        state.current.terms = svc.terms;
        if ($("terms")) $("terms").value = svc.terms;
      }

      updateTotalsLive();
      refreshRowTotal();
    });

    descInput.addEventListener("input", () => {
      it.desc = descInput.value;
    });

    qtyInput.addEventListener("input", () => {
      it.qty = Number(qtyInput.value || 0);
      updateTotalsLive();
      refreshRowTotal();
    });

    priceInput.addEventListener("input", () => {
      const normalized = String(priceInput.value || "").replace(",", ".");
      it.price = Number(normalized || 0);
      updateTotalsLive();
      refreshRowTotal();
    });

    delBtn.addEventListener("click", () => {
      state.current.items = state.current.items.filter((x) => x.id !== it.id);
      if (!state.current.items.length) {
        state.current.items.push({ id: uid("it"), desc: "", qty: 1, price: 0, catId: "", svcId: "" });
      }
      updateTotalsLive();
      renderItemsMobile();
    });

    wrap.appendChild(card);
  });
}

function updateTotalsLive() {
  if (!state.current) return;

  const cfg = state.cfg || defaultCfg();
  const taxRate = Number(cfg.taxRate ?? state.current.taxRate ?? 11.5);
  state.current.taxRate = taxRate;

  let sub = 0;
  (state.current.items || []).forEach((it) => {
    sub += Number(it.qty || 0) * Number(it.price || 0);
  });

  const tax = sub * (taxRate / 100);
  const grand = sub + tax;
  state.current.totals = { sub, tax, grand };

  if ($("subTotal")) $("subTotal").textContent = fmtMoney(sub);
  if ($("taxTotal")) $("taxTotal").textContent = fmtMoney(tax);
  if ($("grandTotal")) $("grandTotal").textContent = fmtMoney(grand);
}

function nextNumber(type) {
  const year = new Date().getFullYear();
  const prefix = type === "FAC" ? "FAC" : "COT";
  const re = new RegExp(`^${prefix}-${year}-(\\d{4})$`);
  let max = 0;

  (state.docs || []).forEach((d) => {
    const m = (d.number || "").match(re);
    if (m) max = Math.max(max, Number(m[1]));
  });

  return `${prefix}-${year}-${String(max + 1).padStart(4, "0")}`;
}

async function saveCurrentToHistory({ forceNumber = false } = {}) {
  if (!state.user) return alert("Necesitas login para guardar.");

  readDocHeaderIntoState();
  updateTotalsLive();

  if (forceNumber || !state.current.number) {
    state.current.number = nextNumber(state.current.type);
    if ($("docNumber")) $("docNumber").value = state.current.number;
  }

  const nowIso = new Date().toISOString();
  state.current.updatedAt = nowIso;
  if (!state.current.createdAt) state.current.createdAt = nowIso;

  const refDoc = doc(db, `${userBase(state.user.uid)}/docs/${state.current.id}`);
  const payload = JSON.parse(JSON.stringify(state.current));
  payload.updatedAt = serverTimestamp();
  if (!payload._createdAtServer) payload._createdAtServer = serverTimestamp();

  await setDoc(refDoc, payload, { merge: true });
  await loadAllFromFirestore();
  state.activeDocId = state.current.id;
}

async function loadDocFromHistory(id) {
  const d = (state.docs || []).find((x) => x.id === id);
  if (!d) return;

  state.activeDocId = d.id;
  state.current = JSON.parse(JSON.stringify(d));
  state.current.items = (state.current.items || []).map((it) => ({
    id: it.id || uid("it"),
    desc: it.desc || "",
    qty: Number(it.qty || 0) || 1,
    price: Number(it.price || 0),
    catId: it.catId || "",
    svcId: it.svcId || ""
  }));

  syncFormFromState();
  updateTotalsLive();
  renderItemsMobile();
  setView("invoicing");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteDocCloud() {
  if (!state.user) return alert("Login requerido.");
  if (!state.activeDocId) return alert("No hay documento seleccionado.");
  if (!confirm("¿Borrar este documento?")) return;

  await deleteDoc(doc(db, `${userBase(state.user.uid)}/docs/${state.activeDocId}`));
  state.activeDocId = null;
  state.current = newDoc();
  syncFormFromState();
  updateTotalsLive();
  renderItemsMobile();
  await loadAllFromFirestore();
}

function duplicateDoc() {
  readDocHeaderIntoState();

  const copy = JSON.parse(JSON.stringify(state.current));
  copy.id = uid("doc");
  copy.number = "";
  copy.status = "PENDIENTE";
  copy.createdAt = new Date().toISOString();
  copy.updatedAt = new Date().toISOString();
  copy.items = (copy.items || []).map((it) => ({
    ...it,
    id: uid("it"),
    catId: it.catId || "",
    svcId: it.svcId || ""
  }));

  state.activeDocId = null;
  state.current = copy;

  syncFormFromState();
  updateTotalsLive();
  renderItemsMobile();
}

function renderHistory() {
  const body = $("histBody");
  if (!body) return;

  const q = (($("histSearch")?.value || "").trim().toLowerCase());
  body.innerHTML = "";

  let rows = [...(state.docs || [])];
  if (q) {
    rows = rows.filter((d) => {
      const s = `${d.number || ""} ${d.client?.name || ""}`.toLowerCase();
      return s.includes(q);
    });
  }

  if (!rows.length) {
    body.innerHTML = `<div class="listCard"><div class="listTitle">Sin historial</div><div class="listSub">Todavía no hay documentos guardados.</div></div>`;
    return;
  }

  rows.forEach((d) => {
    const card = document.createElement("article");
    card.className = "listCard";
    card.innerHTML = `
      <div class="listCardTop">
        <div>
          <div class="listTitle">${escapeHtml(d.number || "AUTO")}</div>
          <div class="listSub">${escapeHtml(d.client?.name || "Sin cliente")}</div>
        </div>
        <span class="badge ${d.status === "PAGADA" ? "ok" : "warn"}">${escapeHtml(d.status || "PENDIENTE")}</span>
      </div>

      <div class="listMeta">
        <div class="metaBlock">
          <div class="metaLabel">Tipo</div>
          <div class="metaValue">${d.type === "FAC" ? "Factura" : "Cotización"}</div>
        </div>
        <div class="metaBlock">
          <div class="metaLabel">Fecha</div>
          <div class="metaValue">${escapeHtml(d.date || "—")}</div>
        </div>
        <div class="metaBlock">
          <div class="metaLabel">Total</div>
          <div class="metaValue">${fmtMoney(d.totals?.grand || 0)}</div>
        </div>
        <div class="metaBlock">
          <div class="metaLabel">Cliente</div>
          <div class="metaValue">${escapeHtml(d.client?.contact || "—")}</div>
        </div>
      </div>

      <div class="cardActions">
        <button class="btn smallBtn hist-open" type="button">Abrir</button>
        <button class="btn smallBtn primary hist-pdf" type="button">PDF</button>
      </div>
    `;

    card.querySelector(".hist-open").onclick = () => loadDocFromHistory(d.id);
    card.querySelector(".hist-pdf").onclick = async () => {
      await loadDocFromHistory(d.id);
      await confirmPDF();
    };

    body.appendChild(card);
  });
}

function refreshKPIs() {
  const docs = state.docs || [];
  const pendingDocs = docs.filter((d) => d.status !== "PAGADA").length;
  const totalFacturado = docs
    .filter((d) => d.type === "FAC")
    .reduce((acc, d) => acc + Number(d.totals?.grand || 0), 0);

  if ($("kpiDocs")) $("kpiDocs").textContent = String(docs.length);
  if ($("kpiPendingDocs")) $("kpiPendingDocs").textContent = String(pendingDocs);
  if ($("kpiLastTotal")) $("kpiLastTotal").textContent = fmtMoney(totalFacturado);
}

function renderReporting() {
  const docs = state.docs || [];
  let pending = 0;
  let paid = 0;

  docs.forEach((d) => {
    const val = Number(d.totals?.grand || 0);
    if (d.status === "PAGADA") paid += val;
    else pending += val;
  });

  if ($("repPending")) $("repPending").textContent = fmtMoney(pending);
  if ($("repPaid")) $("repPaid").textContent = fmtMoney(paid);
  if ($("repDocs")) $("repDocs").textContent = String(docs.length);
}

function renderLastTransactions() {
  const wrap = $("lastTransactionsBody");
  if (!wrap) return;

  wrap.innerHTML = "";

  const rows = [...(state.docs || [])]
    .sort((a, b) => {
      const av = a?.updatedAt?.seconds ? Number(a.updatedAt.seconds) : new Date(a.updatedAt || a.date || 0).getTime();
      const bv = b?.updatedAt?.seconds ? Number(b.updatedAt.seconds) : new Date(b.updatedAt || b.date || 0).getTime();
      return bv - av;
    })
    .slice(0, 5);

  if (!rows.length) {
    wrap.innerHTML = `<div class="listCard"><div class="listTitle">Sin transacciones</div><div class="listSub">Todavía no hay movimiento.</div></div>`;
    return;
  }

  rows.forEach((d) => {
    const card = document.createElement("article");
    card.className = "listCard";
    card.innerHTML = `
      <div class="listCardTop">
        <div>
          <div class="listTitle">${escapeHtml(d.client?.name || d.number || "Documento")}</div>
          <div class="listSub">${escapeHtml(d.date || "—")} · ${d.type === "FAC" ? "Factura" : "Cotización"}</div>
        </div>
        <div class="listTitle">${fmtMoney(d.totals?.grand || 0)}</div>
      </div>
    `;
    wrap.appendChild(card);
  });
}

function toggleCustomerForm(force = null) {
  const card = $("customerFormCard");
  const btn = $("btnToggleCustomerForm");
  if (!card || !btn) return;

  state.customerFormOpen = force === null ? !state.customerFormOpen : !!force;
  card.classList.toggle("is-hidden", !state.customerFormOpen);
  btn.textContent = state.customerFormOpen ? "Ocultar" : "Nuevo cliente";
}

function updateCustomerSearchClear() {
  const btn = $("btnClearCustomerSearch");
  const input = $("cSearch");
  if (!btn || !input) return;
  btn.classList.toggle("show", !!input.value.trim());
}

function renderCustomers() {
  const wrap = $("customersBody");
  if (!wrap) return;

  updateCustomerSearchClear();

  const q = (($("cSearch")?.value || "").trim().toLowerCase());
  let rows = [...(state.customers || [])];

  if (q) {
    rows = rows.filter((c) => {
      const s = `${c.name || ""} ${c.contact || ""} ${c.addr || ""}`.toLowerCase();
      return s.includes(q);
    });
  }

  wrap.innerHTML = "";

  if (!rows.length) {
    wrap.innerHTML = `<div class="listCard"><div class="listTitle">Sin clientes</div><div class="listSub">No hay registros todavía.</div></div>`;
    return;
  }

  rows.forEach((c) => {
    const card = document.createElement("article");
    card.className = "listCard";
    card.innerHTML = `
      <div class="listCardTop">
        <div>
          <div class="listTitle">${escapeHtml(c.name || "")}</div>
          <div class="listSub">${escapeHtml(c.contact || "")}</div>
        </div>
      </div>

      <div class="listMeta">
        <div class="metaBlock">
          <div class="metaLabel">Dirección</div>
          <div class="metaValue">${escapeHtml(c.addr || "—")}</div>
        </div>
        <div class="metaBlock">
          <div class="metaLabel">Nota</div>
          <div class="metaValue">${escapeHtml(c.note || "—")}</div>
        </div>
      </div>

      <div class="cardActions">
        <button class="btn smallBtn use-customer" type="button">Usar</button>
        <button class="btn smallBtn danger del-customer" type="button">Borrar</button>
      </div>
    `;

    card.querySelector(".use-customer").onclick = () => {
      state.current.client.name = c.name || "";
      state.current.client.contact = c.contact || "";
      state.current.client.addr = c.addr || "";
      syncFormFromState();
      setView("invoicing");
      window.scrollTo({ top: 0, behavior: "smooth" });
    };

    card.querySelector(".del-customer").onclick = async () => {
      if (!state.user) return alert("Login requerido.");
      if (!confirm("¿Borrar cliente?")) return;
      await deleteDoc(doc(db, `${userBase(state.user.uid)}/customers/${c.id}`));
      await loadAllFromFirestore();
    };

    wrap.appendChild(card);
  });
}

async function addCustomer() {
  if (!state.user) return alert("Login requerido.");

  const name = ($("cName")?.value || "").trim();
  if (!name) return alert("Nombre requerido.");

  const id = uid("cus");
  const refC = doc(db, `${userBase(state.user.uid)}/customers/${id}`);

  await setDoc(refC, {
    name,
    contact: ($("cContact")?.value || "").trim(),
    addr: ($("cAddr")?.value || "").trim(),
    note: ($("cNote")?.value || "").trim(),
    createdAt: serverTimestamp()
  });

  if ($("cName")) $("cName").value = "";
  if ($("cContact")) $("cContact").value = "";
  if ($("cAddr")) $("cAddr").value = "";
  if ($("cNote")) $("cNote").value = "";

  toggleCustomerForm(false);
  await loadAllFromFirestore();
}

function openBiz() {
  const cfg = state.cfg || defaultCfg();
  if ($("bizName")) $("bizName").value = cfg.biz?.name || "";
  if ($("bizPhone")) $("bizPhone").value = cfg.biz?.phone || "";
  if ($("bizEmail")) $("bizEmail").value = cfg.biz?.email || "";
  if ($("bizAddr")) $("bizAddr").value = cfg.biz?.addr || "";
  if ($("taxRate")) $("taxRate").value = String(cfg.taxRate ?? 11.5);
  if ($("settingsPanel")) $("settingsPanel").style.display = "flex";
}

function closeBiz() {
  if ($("settingsPanel")) $("settingsPanel").style.display = "none";
}

async function saveBiz() {
  if (!state.user) return alert("Login requerido.");

  const cfg = state.cfg || defaultCfg();
  cfg.biz = cfg.biz || {};

  cfg.biz.name = ($("bizName")?.value || "").trim();
  cfg.biz.phone = ($("bizPhone")?.value || "").trim();
  cfg.biz.email = ($("bizEmail")?.value || "").trim();
  cfg.biz.addr = ($("bizAddr")?.value || "").trim();
  cfg.taxRate = Number($("taxRate")?.value || 11.5);

  const file = $("bizLogo")?.files?.[0];

  if (file) {
    try {
      const path = `users/${state.user.uid}/logo_${Date.now()}_${file.name}`;
      const storageRef = ref(storage, path);

      await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(storageRef);
      const logoDataUrl = await normalizeLogoFileForPdf(file);

      cfg.biz.logoUrl = downloadURL;
      cfg.biz.logoDataUrl = logoDataUrl;
    } catch (err) {
      console.error("Error procesando logo:", err);
      alert("No se pudo guardar el logo.");
      return;
    }
  }

  state.cfg = normalizeCfg(cfg);

  try {
    await saveSettingsToFirestore();
    indexCatalog();
    refreshKPIs();
    updateTotalsLive();
    alert("Empresa guardada ✅");
    closeBiz();
  } catch (err) {
    console.error("Error guardando empresa:", err);
    alert("No se pudo guardar la empresa.");
  }
}

function renderInvoicing() {
  if (!state.current) state.current = newDoc();
  syncFormFromState();
  renderItemsMobile();
  updateTotalsLive();
}

function buildPdfDoc() {
  const { jsPDF } = window.jspdf;
  const cfg = state.cfg || defaultCfg();
  const biz = cfg.biz || {};
  const taxRate = Number(cfg.taxRate || 11.5);

  readDocHeaderIntoState();
  updateTotalsLive();

  const docp = new jsPDF({ unit: "pt", format: "a4" });
  const W = docp.internal.pageSize.getWidth();
  const H = docp.internal.pageSize.getHeight();
  const margin = 42;

  docp.setDrawColor(220);
  docp.setLineWidth(1);
  docp.line(margin, 110, W - margin, 110);

  docp.setFont("helvetica", "bold");
  docp.setFontSize(20);
  docp.text(state.current.type === "FAC" ? "FACTURA" : "COTIZACIÓN", margin, 64);

  docp.setFont("helvetica", "normal");
  docp.setFontSize(10);
  docp.text(`No.: ${state.current.number || "AUTO"}`, margin, 86);
  docp.text(`Fecha: ${state.current.date || ""}`, margin, 102);

  const rightX = W - margin;
  let textTopY = 52;

  if (biz.logoDataUrl && String(biz.logoDataUrl).startsWith("data:image/")) {
    try {
      const imgW = 60;
      const imgH = 60;
      const imgX = W - margin - imgW;
      const imgY = 20;
      const format = biz.logoDataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";

      docp.addImage(biz.logoDataUrl, format, imgX, imgY, imgW, imgH);
      textTopY = imgY + imgH + 8;
    } catch (err) {
      console.error("Error renderizando logo en PDF:", err);
    }
  }

  let topY = textTopY;
  docp.setFont("helvetica", "bold");
  docp.setFontSize(12);
  docp.text(biz.name || "Empresa", rightX, topY, { align: "right" });

  docp.setFont("helvetica", "normal");
  docp.setFontSize(10);
  topY += 14;
  if (biz.addr) {
    docp.text(biz.addr, rightX, topY, { align: "right" });
    topY += 12;
  }
  if (biz.phone) {
    docp.text(`Tel: ${biz.phone}`, rightX, topY, { align: "right" });
    topY += 12;
  }
  if (biz.email) {
    docp.text(`Email: ${biz.email}`, rightX, topY, { align: "right" });
    topY += 12;
  }

  const boxY = 132;
  docp.setFillColor(245, 245, 245);
  docp.setDrawColor(230);
  docp.roundedRect(margin, boxY, W - 2 * margin, 74, 10, 10, "FD");

  docp.setTextColor(20);
  docp.setFont("helvetica", "bold");
  docp.setFontSize(10);
  docp.text("Cliente", margin + 14, boxY + 22);

  docp.setFont("helvetica", "normal");
  docp.text(state.current.client.name || "—", margin + 14, boxY + 38);
  docp.text(state.current.client.contact || "—", margin + 14, boxY + 52);
  docp.text(state.current.client.addr || "—", margin + 14, boxY + 66);

  docp.setFont("helvetica", "bold");
  docp.text("Válida hasta", W - margin - 160, boxY + 22);
  docp.setFont("helvetica", "normal");
  docp.text(state.current.validUntil || "—", W - margin - 160, boxY + 40);

  const items = (state.current.items || []).map((it) => {
    const qty = Number(it.qty || 0);
    const price = Number(it.price || 0);
    return [it.desc || "", String(qty), fmtMoney(price), fmtMoney(qty * price)];
  });

  docp.autoTable({
    startY: boxY + 92,
    head: [["Descripción", "Cant.", "Precio", "Total"]],
    body: items,
    styles: { font: "helvetica", fontSize: 10, cellPadding: 8 },
    headStyles: { fillColor: [20, 20, 20], textColor: [255, 255, 255] },
    columnStyles: {
      0: { cellWidth: 280 },
      1: { halign: "right", cellWidth: 70 },
      2: { halign: "right", cellWidth: 90 },
      3: { halign: "right", cellWidth: 90 }
    },
    margin: { left: margin, right: margin }
  });

  const afterTableY = docp.lastAutoTable.finalY + 14;
  const totW = 220;
  const totX = W - margin - totW;
  const totY = afterTableY;

  docp.setFillColor(245, 245, 245);
  docp.setDrawColor(230);
  docp.roundedRect(totX, totY, totW, 74, 10, 10, "FD");

  docp.setFont("helvetica", "normal");
  docp.setFontSize(10);
  docp.text("Subtotal:", totX + 12, totY + 22);
  docp.text(fmtMoney(state.current.totals.sub), totX + totW - 12, totY + 22, { align: "right" });

  docp.text(`IVU (${taxRate.toFixed(2)}%):`, totX + 12, totY + 40);
  docp.text(fmtMoney(state.current.totals.tax), totX + totW - 12, totY + 40, { align: "right" });

  docp.setFont("helvetica", "bold");
  docp.text("TOTAL:", totX + 12, totY + 60);
  docp.text(fmtMoney(state.current.totals.grand), totX + totW - 12, totY + 60, { align: "right" });

  let textY = totY + 98;
  docp.setFont("helvetica", "bold");
  docp.text("Notas", margin, textY);
  docp.setFont("helvetica", "normal");
  docp.text((state.current.notes || "—").slice(0, 650), margin, textY + 14, { maxWidth: W - 2 * margin });

  textY += 70;
  docp.setFont("helvetica", "bold");
  docp.text("Condiciones", margin, textY);
  docp.setFont("helvetica", "normal");
  docp.text((state.current.terms || "—").slice(0, 650), margin, textY + 14, { maxWidth: W - 2 * margin });

  docp.setFontSize(9);
  docp.setTextColor(120);
  docp.text(
    `${biz.name || "Empresa"} · ${state.current.type === "FAC" ? "FACTURA" : "COTIZACIÓN"} ${state.current.number || ""}`,
    margin,
    H - 26
  );

  return docp;
}

function makePreview() {
  try {
    const pdf = buildPdfDoc();
    const blob = pdf.output("blob");
    if (state.previewBlobUrl) URL.revokeObjectURL(state.previewBlobUrl);
    state.previewBlobUrl = URL.createObjectURL(blob);
    if ($("pdfFrame")) $("pdfFrame").src = state.previewBlobUrl;
    setView("preview");
  } catch {
    alert("No se pudo generar preview.");
  }
}

async function confirmPDF() {
  await saveCurrentToHistory({ forceNumber: true });

  try {
    const pdf = buildPdfDoc();
    const file = `${state.current.type}_${state.current.number || "AUTO"}.pdf`;
    pdf.save(file);
    makePreview();
  } catch (err) {
    console.error("PDF falló:", err);
    alert("PDF falló.");
  }
}

function bindEvents() {
  document.querySelectorAll(".bottomLink").forEach((b) => {
    b.addEventListener("click", () => setView(b.dataset.view));
  });

  $("btnQuickQuote")?.addEventListener("click", () => {
    state.activeDocId = null;
    state.current = newDoc("COT");
    renderInvoicing();
    setView("invoicing");
  });

  $("btnQuickInvoice")?.addEventListener("click", () => {
    state.activeDocId = null;
    state.current = newDoc("FAC");
    renderInvoicing();
    setView("invoicing");
  });

  $("btnSettings")?.addEventListener("click", openBiz);
  $("btnOpenConfig")?.addEventListener("click", openBiz);
  $("btnCloseBiz")?.addEventListener("click", closeBiz);
  $("btnSaveBiz")?.addEventListener("click", saveBiz);

  $("btnToggleCustomerForm")?.addEventListener("click", () => toggleCustomerForm());
  $("btnCancelCustomerForm")?.addEventListener("click", () => toggleCustomerForm(false));

  $("cSearch")?.addEventListener("input", () => {
    updateCustomerSearchClear();
    renderCustomers();
  });

  $("btnClearCustomerSearch")?.addEventListener("click", () => {
    if ($("cSearch")) $("cSearch").value = "";
    updateCustomerSearchClear();
    renderCustomers();
  });

  [
    "docType",
    "docNumber",
    "docDate",
    "docStatus",
    "clientName",
    "clientContact",
    "clientAddr",
    "validUntil",
    "notes",
    "terms"
  ].forEach((id) => {
    if (!$(id)) return;
    $(id).addEventListener("input", () => {
      readDocHeaderIntoState();
      updateTotalsLive();
    });
    $(id).addEventListener("change", () => {
      readDocHeaderIntoState();
      updateTotalsLive();
    });
  });

  $("btnAddItem")?.addEventListener("click", () => {
    state.current.items.push({ id: uid("it"), desc: "", qty: 1, price: 0, catId: "", svcId: "" });
    renderItemsMobile();
    updateTotalsLive();
  });

  $("btnSaveDoc")?.addEventListener("click", async () => {
    try {
      await saveCurrentToHistory({ forceNumber: false });
      alert("Guardado ✅");
    } catch (e) {
      console.error(e);
      alert("No se pudo guardar.");
    }
  });

  $("btnPDF")?.addEventListener("click", confirmPDF);
  $("btnConfirmFromPreview")?.addEventListener("click", confirmPDF);
  $("btnRefreshPreview")?.addEventListener("click", makePreview);
  $("btnDuplicate")?.addEventListener("click", duplicateDoc);
  $("btnDelete")?.addEventListener("click", deleteDocCloud);

  $("histSearch")?.addEventListener("input", renderHistory);

  $("btnExportHist")?.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state.docs || [], null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `docs_${toISODate(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $("btnClearHist")?.addEventListener("click", async () => {
    if (!state.user) return alert("Login requerido.");
    if (!confirm("¿Vaciar historial completo?")) return;

    for (const d of state.docs || []) {
      await deleteDoc(doc(db, `${userBase(state.user.uid)}/docs/${d.id}`));
    }
    await loadAllFromFirestore();
  });

  $("btnAddCustomer")?.addEventListener("click", addCustomer);

  $("btnExportBackup")?.addEventListener("click", async () => {
    try {
      await exportBackupFile();
    } catch (e) {
      console.error(e);
      alert("No se pudo exportar backup.");
    }
  });

  $("btnRestoreBackup")?.addEventListener("click", () => {
    $("restoreBackupFile")?.click();
  });

  $("restoreBackupFile")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      await restoreBackupFromFile(file);
    } catch (err) {
      console.error(err);
      alert(err?.message || "No se pudo restaurar.");
    }

    e.target.value = "";
  });
}

function boot() {
  ensureAuthButtons();
  bindEvents();

  state.cfg = normalizeCfg(defaultCfg());
  indexCatalog();
  state.current = newDoc("COT");

  setView("home");
  syncFormFromState();
  renderItemsMobile();
  updateTotalsLive();
  refreshKPIs();
  renderLastTransactions();
  toggleCustomerForm(false);
  updateCustomerSearchClear();

  onAuthStateChanged(auth, async (user) => {
    state.user = user || null;
    refreshAuthUI();

    if (state.user) {
      await loadAllFromFirestore();
    } else {
      state.cfg = normalizeCfg(defaultCfg());
      indexCatalog();
      state.docs = [];
      state.customers = [];
      refreshKPIs();
      renderLastTransactions();
      renderHistory();
      renderCustomers();
      renderReporting();
    }

    if (!state.current) state.current = newDoc("COT");
    state.current.taxRate = Number(state.cfg.taxRate || 11.5);
    syncFormFromState();
    updateTotalsLive();
    renderItemsMobile();
  });
}

document.addEventListener("DOMContentLoaded", boot);

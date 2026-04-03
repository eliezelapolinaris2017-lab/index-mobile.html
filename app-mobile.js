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

const CACHE_KEYS = {
  docs: "nexus_inv_mobile_cache_docs_v6",
  customers: "nexus_inv_mobile_cache_customers_v6",
  cfg: "nexus_inv_mobile_cache_cfg_v6",
  current: "nexus_inv_mobile_cache_current_v6",
  activeDocId: "nexus_inv_mobile_cache_activeDocId_v6"
};

const state = {
  user: null,
  view: "invoicing",
  activeDocId: null,
  current: null,
  docs: [],
  customers: [],
  cfg: null,
  previewBlobUrl: null,
  customerFormOpen: false,
  editingCustomerId: null,
  catalogIndex: { catById: new Map(), svcById: new Map() }
};

function hideSplashScreen() {
  const splash = $("appSplash");
  if (!splash) return;
  setTimeout(() => splash.classList.add("is-hidden"), 1200);
}

const fmtMoney = (n) => {
  return Number(n || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD"
  });
};

function toISODate(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

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

function defaultCatalog() {
  return {
    categories: [
      {
        id: "cat_mant",
        name: "Mantenimiento",
        services: [
          {
            id: "svc_mant_res",
            name: "Mantenimiento Preventivo",
            desc: "Servicio preventivo: limpieza, revisión eléctrica, drenajes y prueba operacional.",
            price: 55,
            notes: "Precio sujeto a acceso y condición.",
            terms: "Pago contra entrega."
          }
        ]
      },
      {
        id: "cat_diag",
        name: "Diagnóstico",
        services: [
          {
            id: "svc_diag",
            name: "Diagnóstico Técnico",
            desc: "Evaluación técnica y recomendación de reparación.",
            price: 45,
            notes: "Diagnóstico no incluye reparación ni piezas.",
            terms: "El diagnóstico se acredita si se aprueba la reparación el mismo día."
          }
        ]
      }
    ]
  };
}

function defaultCfg() {
  return {
    biz: {
      name: "Tu Empresa",
      phone: "",
      email: "",
      addr: "Puerto Rico",
      paymentLabel: "Pagar ahora",
      paymentLink: "",
      logoUrl: "",
      logoDataUrl: ""
    },
    taxRate: 11.5,
    catalog: defaultCatalog()
  };
}

function normalizeCfg(cfg) {
  const base = defaultCfg();
  const merged = { ...base, ...(cfg || {}) };

  merged.biz = { ...base.biz, ...(cfg?.biz || {}) };
  merged.taxRate = Number(cfg?.taxRate ?? base.taxRate);
  merged.catalog = cfg?.catalog?.categories ? cfg.catalog : base.catalog;

  merged.catalog.categories = (merged.catalog.categories || []).map((c) => ({
    id: String(c.id || uid("cat")),
    name: String(c.name || "Categoría"),
    services: (c.services || []).map((s) => ({
      id: String(s.id || uid("svc")),
      name: String(s.name || "Servicio"),
      desc: String(s.desc || ""),
      price: Number(s.price || 0),
      notes: String(s.notes || ""),
      terms: String(s.terms || "")
    }))
  }));

  return merged;
}

function indexCatalog() {
  state.catalogIndex.catById = new Map();
  state.catalogIndex.svcById = new Map();

  const cats = state.cfg?.catalog?.categories || [];
  cats.forEach((cat) => {
    state.catalogIndex.catById.set(cat.id, cat);
    (cat.services || []).forEach((svc) => {
      state.catalogIndex.svcById.set(svc.id, { ...svc, _catId: cat.id });
    });
  });
}

function emptyItem() {
  return {
    id: uid("it"),
    desc: "",
    qty: 1,
    price: 0,
    catId: "",
    svcId: ""
  };
}

function newDoc(type = "FAC") {
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
    items: [emptyItem()],
    notes: "",
    terms: "",
    totals: { sub: 0, tax: 0, grand: 0 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    taxRate: Number(state.cfg?.taxRate ?? 11.5),
    lastPdfUrl: ""
  };
}

function normalizeDoc(d) {
  const type = d?.type === "COT" ? "COT" : "FAC";
  return {
    id: String(d?.id || uid("doc")),
    type,
    number: String(d?.number || ""),
    date: String(d?.date || toISODate(new Date())),
    status: String(d?.status || "PENDIENTE"),
    client: {
      name: String(d?.client?.name || ""),
      contact: String(d?.client?.contact || ""),
      addr: String(d?.client?.addr || "")
    },
    validUntil: String(d?.validUntil || toISODate(new Date(Date.now() + 14 * 24 * 3600 * 1000))),
    items: Array.isArray(d?.items) && d.items.length
      ? d.items.map((it) => ({
          id: String(it?.id || uid("it")),
          desc: String(it?.desc || ""),
          qty: Number(it?.qty || 1),
          price: Number(it?.price || 0),
          catId: String(it?.catId || ""),
          svcId: String(it?.svcId || "")
        }))
      : [emptyItem()],
    notes: String(d?.notes || ""),
    terms: String(d?.terms || ""),
    totals: {
      sub: Number(d?.totals?.sub || 0),
      tax: Number(d?.totals?.tax || 0),
      grand: Number(d?.totals?.grand || 0)
    },
    createdAt: d?.createdAt || new Date().toISOString(),
    updatedAt: d?.updatedAt || new Date().toISOString(),
    taxRate: Number(d?.taxRate ?? state.cfg?.taxRate ?? 11.5),
    lastPdfUrl: String(d?.lastPdfUrl || "")
  };
}

function normalizeCustomer(c) {
  return {
    id: String(c?.id || uid("cus")),
    name: String(c?.name || ""),
    contact: String(c?.contact || ""),
    addr: String(c?.addr || ""),
    note: String(c?.note || "")
  };
}

function cacheSave() {
  try {
    localStorage.setItem(CACHE_KEYS.docs, JSON.stringify(state.docs || []));
    localStorage.setItem(CACHE_KEYS.customers, JSON.stringify(state.customers || []));
    localStorage.setItem(CACHE_KEYS.cfg, JSON.stringify(state.cfg || defaultCfg()));
    localStorage.setItem(CACHE_KEYS.current, JSON.stringify(state.current || newDoc("FAC")));
    localStorage.setItem(CACHE_KEYS.activeDocId, state.activeDocId || "");
  } catch (err) {
    console.warn("Cache local falló:", err);
  }
}

function cacheLoad() {
  try {
    const docs = JSON.parse(localStorage.getItem(CACHE_KEYS.docs) || "[]");
    const customers = JSON.parse(localStorage.getItem(CACHE_KEYS.customers) || "[]");
    const cfg = JSON.parse(localStorage.getItem(CACHE_KEYS.cfg) || "null");
    const current = JSON.parse(localStorage.getItem(CACHE_KEYS.current) || "null");
    const activeDocId = localStorage.getItem(CACHE_KEYS.activeDocId) || "";

    state.cfg = normalizeCfg(cfg || defaultCfg());
    indexCatalog();
    state.docs = Array.isArray(docs) ? docs.map(normalizeDoc) : [];
    state.customers = Array.isArray(customers) ? customers.map(normalizeCustomer) : [];
    state.current = current ? normalizeDoc(current) : newDoc("FAC");
    state.activeDocId = activeDocId || null;
  } catch {
    state.cfg = normalizeCfg(defaultCfg());
    indexCatalog();
    state.docs = [];
    state.customers = [];
    state.current = newDoc("FAC");
    state.activeDocId = null;
  }
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

  const settingsSnap = await getDoc(docSettings(state.user.uid));
  state.cfg = settingsSnap.exists() ? normalizeCfg(settingsSnap.data()) : normalizeCfg(defaultCfg());
  indexCatalog();

  const qDocs = query(colDocs(state.user.uid), orderBy("updatedAt", "desc"));
  const docsSnap = await getDocs(qDocs);
  state.docs = docsSnap.docs.map((d) => normalizeDoc({ id: d.id, ...d.data() }));

  const qCustomers = query(colCustomers(state.user.uid), orderBy("createdAt", "desc"));
  const customersSnap = await getDocs(qCustomers);
  state.customers = customersSnap.docs.map((d) => normalizeCustomer({ id: d.id, ...d.data() }));

  if (state.activeDocId) {
    const live = state.docs.find((x) => x.id === state.activeDocId);
    if (live) state.current = normalizeDoc(live);
  }

  cacheSave();
  refreshAllUI();
}

async function saveSettingsToFirestore() {
  if (!state.user) return;
  await setDoc(
    docSettings(state.user.uid),
    {
      ...JSON.parse(JSON.stringify(normalizeCfg(state.cfg))),
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
  cacheSave();
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
}

function refreshAllUI() {
  refreshKPIs();
  renderLastTransactions();
  renderHistory();
  renderCustomers();
  renderInvoicing();
}

function syncFormFromState() {
  if (!state.current) return;

  $("docType").value = state.current.type || "FAC";
  $("docNumber").value = state.current.number || "";
  $("docDate").value = state.current.date || toISODate(new Date());
  $("docStatus").value = state.current.status || "PENDIENTE";

  $("clientName").value = state.current.client?.name || "";
  $("clientContact").value = state.current.client?.contact || "";
  $("clientAddr").value = state.current.client?.addr || "";
  $("validUntil").value = state.current.validUntil || "";
  $("notes").value = state.current.notes || "";
  $("terms").value = state.current.terms || "";

  $("docModePill").textContent = state.activeDocId ? "Editando" : "Nuevo";
  renderPaymentPanel();
}

function readDocHeaderIntoState() {
  if (!state.current) return;

  const oldType = state.current.type || "FAC";
  const newType = $("docType")?.value || "FAC";

  state.current.type = newType;
  state.current.date = $("docDate")?.value || toISODate(new Date());
  state.current.status = $("docStatus")?.value || "PENDIENTE";
  state.current.client.name = ($("clientName")?.value || "").trim();
  state.current.client.contact = ($("clientContact")?.value || "").trim();
  state.current.client.addr = ($("clientAddr")?.value || "").trim();
  state.current.validUntil = $("validUntil")?.value || "";
  state.current.notes = ($("notes")?.value || "").trim();
  state.current.terms = ($("terms")?.value || "").trim();

  const manualNumber = ($("docNumber")?.value || "").trim();
  if (manualNumber) {
    state.current.number = manualNumber;
  } else if (oldType !== newType) {
    state.current.number = "";
  }
}

function buildCategoryOptions(selectedCat = "") {
  const cats = state.cfg?.catalog?.categories || [];
  let html = `<option value="">Categoría</option>`;
  cats.forEach((cat) => {
    html += `<option value="${escapeHtml(cat.id)}" ${cat.id === selectedCat ? "selected" : ""}>${escapeHtml(cat.name)}</option>`;
  });
  return html;
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
            <input class="input item-qty" type="number" min="0" step="1" value="${Number(it.qty || 1)}" />
          </div>
          <div class="field">
            <label>Precio</label>
            <input class="input item-price" type="number" min="0" step="0.01" value="${Number(it.price || 0)}" />
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
      cacheSave();
      refreshRowTotal();
    });

    svcSel.addEventListener("change", () => {
      it.svcId = svcSel.value || "";
      const svc = state.catalogIndex.svcById.get(it.svcId);
      if (!svc) {
        updateTotalsLive();
        cacheSave();
        return;
      }

      it.desc = svc.desc || svc.name || "";
      it.price = Number(svc.price || 0);
      descInput.value = it.desc;
      priceInput.value = String(it.price);

      if ((!state.current.notes || !state.current.notes.trim()) && svc.notes) {
        state.current.notes = svc.notes;
        $("notes").value = svc.notes;
      }
      if ((!state.current.terms || !state.current.terms.trim()) && svc.terms) {
        state.current.terms = svc.terms;
        $("terms").value = svc.terms;
      }

      updateTotalsLive();
      cacheSave();
      refreshRowTotal();
    });

    descInput.addEventListener("input", () => {
      it.desc = descInput.value;
      cacheSave();
    });

    qtyInput.addEventListener("input", () => {
      it.qty = Number(qtyInput.value || 0);
      updateTotalsLive();
      cacheSave();
      refreshRowTotal();
    });

    priceInput.addEventListener("input", () => {
      const normalized = String(priceInput.value || "").replace(",", ".");
      it.price = Number(normalized || 0);
      updateTotalsLive();
      cacheSave();
      refreshRowTotal();
    });

    delBtn.addEventListener("click", () => {
      state.current.items = state.current.items.filter((x) => x.id !== it.id);
      if (!state.current.items.length) state.current.items.push(emptyItem());
      updateTotalsLive();
      renderItemsMobile();
      cacheSave();
    });

    wrap.appendChild(card);
  });
}

function updateTotalsLive() {
  if (!state.current) return;

  readDocHeaderIntoState();

  const taxRate = Number(state.cfg?.taxRate ?? state.current.taxRate ?? 11.5);
  state.current.taxRate = taxRate;

  let sub = 0;
  (state.current.items || []).forEach((it) => {
    sub += Number(it.qty || 0) * Number(it.price || 0);
  });

  const tax = sub * (taxRate / 100);
  const grand = sub + tax;

  state.current.totals = { sub, tax, grand };
  $("subTotal").textContent = fmtMoney(sub);
  $("taxTotal").textContent = fmtMoney(tax);
  $("grandTotal").textContent = fmtMoney(grand);

  renderPaymentPanel();
  cacheSave();
}

function renderPaymentPanel() {
  const label = state.cfg?.biz?.paymentLabel || "Pagar ahora";
  const link = state.cfg?.biz?.paymentLink || "";

  if ($("paymentLabelPreview")) $("paymentLabelPreview").value = label;
  if ($("paymentLinkPreview")) $("paymentLinkPreview").value = link;
  if ($("btnOpenPaymentLink")) $("btnOpenPaymentLink").disabled = !link.trim();
}

function renderInvoicing() {
  syncFormFromState();
  renderItemsMobile();
  updateTotalsLive();
}

function nextNumber(type) {
  const year = new Date().getFullYear();
  const prefix = type === "FAC" ? "FAC" : "COT";
  const re = new RegExp(`^${prefix}-${year}-(\\d{4})$`);
  let max = 0;

  (state.docs || []).forEach((d) => {
    const m = String(d.number || "").match(re);
    if (m) max = Math.max(max, Number(m[1]));
  });

  if (state.current?.number) {
    const currentMatch = String(state.current.number).match(re);
    if (currentMatch) max = Math.max(max, Number(currentMatch[1]));
  }

  return `${prefix}-${year}-${String(max + 1).padStart(4, "0")}`;
}

function ensureStableNumber() {
  if (!state.current.number || !state.current.number.trim()) {
    state.current.number = nextNumber(state.current.type || "FAC");
    $("docNumber").value = state.current.number;
  }
}

async function saveCurrentToHistory() {
  if (!state.user) return alert("Necesitas login para guardar.");

  readDocHeaderIntoState();
  updateTotalsLive();
  ensureStableNumber();

  const nowIso = new Date().toISOString();
  state.current.updatedAt = nowIso;
  if (!state.current.createdAt) state.current.createdAt = nowIso;

  const payload = JSON.parse(JSON.stringify(normalizeDoc(state.current)));
  payload.updatedAt = serverTimestamp();
  if (!payload._createdAtServer) payload._createdAtServer = serverTimestamp();

  const refDoc = doc(db, `${userBase(state.user.uid)}/docs/${state.current.id}`);
  await setDoc(refDoc, payload, { merge: true });

  const idx = state.docs.findIndex((x) => x.id === state.current.id);
  if (idx >= 0) state.docs[idx] = normalizeDoc(payload);
  else state.docs.unshift(normalizeDoc(payload));

  state.activeDocId = state.current.id;
  cacheSave();
  await loadAllFromFirestore();
}

async function loadDocFromHistory(id) {
  const found = (state.docs || []).find((x) => x.id === id);
  if (!found) return;

  state.activeDocId = found.id;
  state.current = normalizeDoc(found);

  syncFormFromState();
  renderItemsMobile();
  updateTotalsLive();
  cacheSave();
  setView("invoicing");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteDocCloud() {
  if (!state.user) return alert("Login requerido.");
  if (!state.activeDocId) return alert("No hay documento seleccionado.");
  if (!confirm("¿Borrar este documento?")) return;

  await deleteDoc(doc(db, `${userBase(state.user.uid)}/docs/${state.activeDocId}`));
  state.docs = state.docs.filter((d) => d.id !== state.activeDocId);
  state.activeDocId = null;
  state.current = newDoc("FAC");
  cacheSave();
  refreshAllUI();
}

function duplicateDoc() {
  readDocHeaderIntoState();

  const copy = normalizeDoc(state.current);
  copy.id = uid("doc");
  copy.number = "";
  copy.status = "PENDIENTE";
  copy.createdAt = new Date().toISOString();
  copy.updatedAt = new Date().toISOString();
  copy.items = (copy.items || []).map((it) => ({
    ...it,
    id: uid("it")
  }));

  state.activeDocId = null;
  state.current = copy;
  syncFormFromState();
  renderItemsMobile();
  updateTotalsLive();
  cacheSave();
}

async function quickMarkPaid(id) {
  if (!state.user) return alert("Login requerido.");
  const docItem = state.docs.find((x) => x.id === id);
  if (!docItem) return;
  if (docItem.type !== "FAC") return alert("Solo las facturas pueden marcarse como pagadas.");

  docItem.status = "PAGADA";
  docItem.updatedAt = new Date().toISOString();

  await setDoc(
    doc(db, `${userBase(state.user.uid)}/docs/${id}`),
    {
      status: "PAGADA",
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );

  if (state.activeDocId === id && state.current) {
    state.current.status = "PAGADA";
    syncFormFromState();
  }

  cacheSave();
  await loadAllFromFirestore();
}

function renderHistory() {
  const body = $("histBody");
  if (!body) return;

  const q = ($("histSearch")?.value || "").trim().toLowerCase();
  body.innerHTML = "";

  let rows = [...(state.docs || [])];
  if (q) {
    rows = rows.filter((d) => {
      const s = `${d.number || ""} ${d.client?.name || ""} ${d.type || ""}`.toLowerCase();
      return s.includes(q);
    });
  }

  if (!rows.length) {
    body.innerHTML = `<div class="listCard"><div class="listTitle">Sin historial</div><div class="listSub">Todavía no hay documentos guardados.</div></div>`;
    return;
  }

  rows.forEach((d) => {
    const isInvoice = d.type === "FAC";
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
          <div class="metaValue">${isInvoice ? "Factura" : "Cotización"}</div>
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
        ${isInvoice && d.status !== "PAGADA" ? `<button class="btn smallBtn hist-paid" type="button">Marcar pagada</button>` : ""}
        <button class="btn smallBtn primary hist-pdf" type="button">PDF</button>
      </div>
    `;

    card.querySelector(".hist-open").onclick = () => loadDocFromHistory(d.id);

    const paidBtn = card.querySelector(".hist-paid");
    if (paidBtn) paidBtn.onclick = () => quickMarkPaid(d.id);

    card.querySelector(".hist-pdf").onclick = async () => {
      await loadDocFromHistory(d.id);
      await confirmPDF();
    };

    body.appendChild(card);
  });
}

function refreshKPIs() {
  const docs = state.docs || [];
  const pendingDocs = docs.filter((d) => d.type === "FAC" && d.status !== "PAGADA").length;
  const totalFacturado = docs
    .filter((d) => d.type === "FAC")
    .reduce((acc, d) => acc + Number(d.totals?.grand || 0), 0);

  $("kpiDocs").textContent = String(docs.length);
  $("kpiPendingDocs").textContent = String(pendingDocs);
  $("kpiLastTotal").textContent = fmtMoney(totalFacturado);
}

function renderLastTransactions() {
  const wrap = $("lastTransactionsBody");
  if (!wrap) return;

  wrap.innerHTML = "";
  const rows = [...(state.docs || [])].slice(0, 5);

  if (!rows.length) {
    wrap.innerHTML = `<div class="listCard"><div class="listTitle">Sin actividad</div><div class="listSub">Aún no hay documentos guardados.</div></div>`;
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
          <div class="metaLabel">Total</div>
          <div class="metaValue">${fmtMoney(d.totals?.grand || 0)}</div>
        </div>
      </div>
    `;
    wrap.appendChild(card);
  });
}

function updateCustomerSearchClear() {
  const btn = $("btnClearCustomerSearch");
  const input = $("cSearch");
  if (!btn || !input) return;
  btn.classList.toggle("show", !!input.value.trim());
}

function fillCustomerForm(customer = null) {
  $("cName").value = customer?.name || "";
  $("cContact").value = customer?.contact || "";
  $("cAddr").value = customer?.addr || "";
  $("cNote").value = customer?.note || "";
}

function toggleCustomerForm(force = null, customer = null) {
  const card = $("customerFormCard");
  const btn = $("btnToggleCustomerForm");
  if (!card || !btn) return;

  state.customerFormOpen = force === null ? !state.customerFormOpen : !!force;
  state.editingCustomerId = customer?.id || null;

  card.classList.toggle("is-hidden", !state.customerFormOpen);
  btn.textContent = state.customerFormOpen ? "Ocultar" : "Nuevo cliente";

  const titleNode = card.querySelector(".sectionMiniTitle");
  if (titleNode) titleNode.textContent = state.editingCustomerId ? "Editar cliente" : "Nuevo cliente";

  if (state.customerFormOpen) {
    fillCustomerForm(customer);
  } else {
    state.editingCustomerId = null;
    fillCustomerForm(null);
  }
}

function renderCustomers() {
  const wrap = $("customersBody");
  if (!wrap) return;

  wrap.innerHTML = "";
  const q = ($("cSearch")?.value || "").trim().toLowerCase();

  let rows = [...(state.customers || [])];
  if (q) {
    rows = rows.filter((c) => {
      const s = `${c.name || ""} ${c.contact || ""} ${c.addr || ""}`.toLowerCase();
      return s.includes(q);
    });
  }

  if (!rows.length) {
    wrap.innerHTML = `<div class="listCard"><div class="listTitle">Sin clientes</div><div class="listSub">No tienes clientes guardados todavía.</div></div>`;
    return;
  }

  rows.forEach((c) => {
    const card = document.createElement("article");
    card.className = "listCard";
    card.innerHTML = `
      <div class="listCardTop">
        <div>
          <div class="listTitle">${escapeHtml(c.name || "Cliente")}</div>
          <div class="listSub">${escapeHtml(c.contact || "—")}</div>
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
        <button class="btn smallBtn edit-customer" type="button">Editar</button>
        <button class="btn smallBtn danger del-customer" type="button">Borrar</button>
      </div>
    `;

    card.querySelector(".use-customer").onclick = () => {
      state.current.client.name = c.name || "";
      state.current.client.contact = c.contact || "";
      state.current.client.addr = c.addr || "";
      syncFormFromState();
      cacheSave();
      setView("invoicing");
      window.scrollTo({ top: 0, behavior: "smooth" });
    };

    card.querySelector(".edit-customer").onclick = () => {
      toggleCustomerForm(true, c);
      window.scrollTo({ top: 0, behavior: "smooth" });
    };

    card.querySelector(".del-customer").onclick = async () => {
      if (!state.user) return alert("Login requerido.");
      if (!confirm("¿Borrar cliente?")) return;
      await deleteDoc(doc(db, `${userBase(state.user.uid)}/customers/${c.id}`));
      state.customers = state.customers.filter((x) => x.id !== c.id);
      cacheSave();
      await loadAllFromFirestore();
    };

    wrap.appendChild(card);
  });
}

async function saveCustomer() {
  if (!state.user) return alert("Login requerido.");

  const name = ($("cName")?.value || "").trim();
  if (!name) return alert("Nombre requerido.");

  const payload = {
    name,
    contact: ($("cContact")?.value || "").trim(),
    addr: ($("cAddr")?.value || "").trim(),
    note: ($("cNote")?.value || "").trim(),
    updatedAt: serverTimestamp()
  };

  if (state.editingCustomerId) {
    await setDoc(
      doc(db, `${userBase(state.user.uid)}/customers/${state.editingCustomerId}`),
      payload,
      { merge: true }
    );
  } else {
    const id = uid("cus");
    await setDoc(
      doc(db, `${userBase(state.user.uid)}/customers/${id}`),
      {
        ...payload,
        createdAt: serverTimestamp()
      },
      { merge: true }
    );
  }

  fillCustomerForm(null);
  toggleCustomerForm(false);
  await loadAllFromFirestore();
}

function openBiz() {
  const cfg = state.cfg || defaultCfg();
  $("bizName").value = cfg.biz?.name || "";
  $("bizPhone").value = cfg.biz?.phone || "";
  $("bizEmail").value = cfg.biz?.email || "";
  $("bizAddr").value = cfg.biz?.addr || "";
  $("bizPaymentLabel").value = cfg.biz?.paymentLabel || "Pagar ahora";
  $("bizPaymentLink").value = cfg.biz?.paymentLink || "";
  $("taxRate").value = String(cfg.taxRate ?? 11.5);
  $("settingsPanel").style.display = "flex";
}

function closeBiz() {
  $("settingsPanel").style.display = "none";
}

async function saveBiz() {
  if (!state.user) return alert("Login requerido.");

  const cfg = normalizeCfg(state.cfg || defaultCfg());
  cfg.biz.name = ($("bizName")?.value || "").trim();
  cfg.biz.phone = ($("bizPhone")?.value || "").trim();
  cfg.biz.email = ($("bizEmail")?.value || "").trim();
  cfg.biz.addr = ($("bizAddr")?.value || "").trim();
  cfg.biz.paymentLabel = ($("bizPaymentLabel")?.value || "").trim() || "Pagar ahora";
  cfg.biz.paymentLink = ($("bizPaymentLink")?.value || "").trim();
  cfg.taxRate = Number($("taxRate")?.value || 11.5);

  const logoFile = $("bizLogo")?.files?.[0];
  if (logoFile) {
    const storagePath = `users/${state.user.uid}/branding/logo_${Date.now()}_${logoFile.name}`;
    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, logoFile);
    cfg.biz.logoUrl = await getDownloadURL(storageRef);
    cfg.biz.logoDataUrl = await normalizeLogoFileForPdf(logoFile);
  }

  state.cfg = cfg;
  indexCatalog();
  await saveSettingsToFirestore();

  if (state.current) {
    state.current.taxRate = Number(cfg.taxRate || 11.5);
    updateTotalsLive();
  }

  closeBiz();
  cacheSave();
  refreshAllUI();
}

async function buildBackupPayload() {
  return {
    exportedAt: new Date().toISOString(),
    version: "nexus_invoicing_mobile_backup_local_v6",
    docs: state.docs || [],
    customers: state.customers || [],
    cfg: state.cfg || defaultCfg()
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

  if (!parsed || !Array.isArray(parsed.docs) || !Array.isArray(parsed.customers)) {
    throw new Error("Archivo de backup inválido.");
  }

  state.cfg = normalizeCfg(parsed.cfg || defaultCfg());
  await saveSettingsToFirestore();

  for (const c of parsed.customers) {
    const cid = c.id || uid("cus");
    await setDoc(
      doc(db, `${userBase(state.user.uid)}/customers/${cid}`),
      {
        ...normalizeCustomer({ ...c, id: cid }),
        restoredAt: serverTimestamp()
      },
      { merge: true }
    );
  }

  for (const d of parsed.docs) {
    const did = d.id || uid("doc");
    await setDoc(
      doc(db, `${userBase(state.user.uid)}/docs/${did}`),
      {
        ...normalizeDoc({ ...d, id: did }),
        restoredAt: serverTimestamp()
      },
      { merge: true }
    );
  }

  await loadAllFromFirestore();
  alert("Backup restaurado ✅");
}

function drawPdfPaymentButton(pdf, x, y, w, h, label, url) {
  pdf.setFillColor(225, 0, 168);
  pdf.setDrawColor(225, 0, 168);
  pdf.roundedRect(x, y, w, h, 8, 8, "F");

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.setTextColor(255, 255, 255);
  pdf.text(label, x + w / 2, y + h / 2 + 4, { align: "center" });

  try {
    pdf.link(x, y, w, h, { url });
  } catch {}

  pdf.setTextColor(0, 0, 0);
}

function buildPdfDoc() {
  readDocHeaderIntoState();
  updateTotalsLive();

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF("p", "pt", "letter");
  const cfg = state.cfg || defaultCfg();
  const biz = cfg.biz || {};
  const docData = state.current;

  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 40;
  let y = 42;

  if (biz.logoDataUrl) {
    try {
      pdf.addImage(biz.logoDataUrl, "PNG", margin, y - 4, 58, 58);
    } catch {}
  }

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(18);
  pdf.text(String(biz.name || "Tu Empresa"), biz.logoDataUrl ? 108 : margin, y + 14);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  const bizLines = [biz.phone || "", biz.email || "", biz.addr || ""].filter(Boolean);
  bizLines.forEach((line, i) => {
    pdf.text(String(line), biz.logoDataUrl ? 108 : margin, y + 34 + i * 14);
  });

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(18);
  pdf.text(docData.type === "FAC" ? "FACTURA" : "COTIZACIÓN", pageW - margin, y + 16, { align: "right" });

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.text(`Número: ${docData.number || "AUTO"}`, pageW - margin, y + 36, { align: "right" });
  pdf.text(`Fecha: ${docData.date || "—"}`, pageW - margin, y + 50, { align: "right" });
  pdf.text(`Estado: ${docData.status || "PENDIENTE"}`, pageW - margin, y + 64, { align: "right" });

  y = 126;

  pdf.setDrawColor(226, 226, 234);
  pdf.line(margin, y, pageW - margin, y);
  y += 18;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.text("CLIENTE", margin, y);
  y += 16;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  const clientLines = [
    docData.client?.name || "",
    docData.client?.contact || "",
    docData.client?.addr || "",
    docData.type === "COT" && docData.validUntil ? `Válida hasta: ${docData.validUntil}` : ""
  ].filter(Boolean);

  clientLines.forEach((line) => {
    pdf.text(String(line), margin, y);
    y += 14;
  });

  y += 12;

  const rows = (docData.items || []).map((it) => [
    String(it.desc || "Item"),
    String(Number(it.qty || 0)),
    fmtMoney(it.price || 0),
    fmtMoney(Number(it.qty || 0) * Number(it.price || 0))
  ]);

  pdf.autoTable({
    startY: y,
    head: [["Descripción", "Cant.", "Precio", "Total"]],
    body: rows,
    margin: { left: margin, right: margin },
    styles: {
      font: "helvetica",
      fontSize: 10,
      cellPadding: 8,
      lineColor: [228, 228, 228],
      lineWidth: 0.5,
      textColor: [20, 20, 20]
    },
    headStyles: {
      fillColor: [245, 245, 245],
      textColor: [20, 20, 20],
      lineColor: [228, 228, 228],
      lineWidth: 0.5,
      fontStyle: "bold"
    },
    alternateRowStyles: {
      fillColor: [255, 255, 255]
    },
    bodyStyles: {
      fillColor: [255, 255, 255]
    },
    theme: "grid"
  });

  y = pdf.lastAutoTable.finalY + 18;

  const totalsX = pageW - margin;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.text(`Subtotal: ${fmtMoney(docData.totals?.sub || 0)}`, totalsX, y, { align: "right" });
  y += 16;
  pdf.text(`IVU: ${fmtMoney(docData.totals?.tax || 0)}`, totalsX, y, { align: "right" });
  y += 18;
  pdf.setFontSize(13);
  pdf.text(`Total: ${fmtMoney(docData.totals?.grand || 0)}`, totalsX, y, { align: "right" });

  const paymentAnchorY = y + 12;

  y += 36;

  if (docData.notes) {
    pdf.setFontSize(11);
    pdf.setFont("helvetica", "bold");
    pdf.text("NOTAS", margin, y);
    y += 16;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    const noteLines = pdf.splitTextToSize(String(docData.notes), pageW - margin * 2 - 180);
    pdf.text(noteLines, margin, y);
    y += noteLines.length * 12 + 18;
  }

  if (docData.terms) {
    pdf.setFontSize(11);
    pdf.setFont("helvetica", "bold");
    pdf.text("CONDICIONES", margin, y);
    y += 16;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    const termLines = pdf.splitTextToSize(String(docData.terms), pageW - margin * 2 - 180);
    pdf.text(termLines, margin, y);
    y += termLines.length * 12 + 18;
  }

  if (biz.paymentLink) {
    const btnLabel = biz.paymentLabel || "Pagar ahora";
    const btnW = 132;
    const btnH = 28;
    const btnX = pageW - margin - btnW;
    let btnY = paymentAnchorY;

    if (btnY > pageH - 80) {
      pdf.addPage();
      btnY = 60;
    }

    drawPdfPaymentButton(pdf, btnX, btnY, btnW, btnH, btnLabel, biz.paymentLink);
  }

  return pdf;
}

async function createPdfBlobAndEnsureSaved() {
  await saveCurrentToHistory();
  const pdf = buildPdfDoc();
  const blob = pdf.output("blob");
  const safeName = `${state.current.type}_${state.current.number || "AUTO"}.pdf`;
  return { pdf, blob, safeName };
}

async function uploadInvoicePdfAndGetUrl() {
  if (!state.user) throw new Error("Login requerido.");

  const { blob, safeName } = await createPdfBlobAndEnsureSaved();
  const path = `users/${state.user.uid}/sent-pdfs/${safeName}`;
  const storageRef = ref(storage, path);

  await uploadBytes(storageRef, blob, { contentType: "application/pdf" });
  const pdfUrl = await getDownloadURL(storageRef);

  await setDoc(
    doc(db, `${userBase(state.user.uid)}/docs/${state.current.id}`),
    {
      lastPdfUrl: pdfUrl,
      lastPdfSentAt: serverTimestamp()
    },
    { merge: true }
  );

  state.current.lastPdfUrl = pdfUrl;
  const idx = state.docs.findIndex((d) => d.id === state.current.id);
  if (idx >= 0) state.docs[idx].lastPdfUrl = pdfUrl;
  cacheSave();

  return pdfUrl;
}

async function confirmPDF() {
  if (!state.user) return alert("Login requerido.");

  try {
    const { pdf, blob, safeName } = await createPdfBlobAndEnsureSaved();
    const file = new File([blob], safeName, { type: "application/pdf" });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: safeName,
        text: `${state.current.type === "FAC" ? "Factura" : "Cotización"} ${state.current.number || ""}`.trim()
      });
      return;
    }

    pdf.save(safeName);
  } catch (err) {
    if (err?.name === "AbortError") return;
    console.error("PDF falló:", err);
    alert("No se pudo generar o compartir el PDF.");
  }
}

function extractPhoneFromContact(raw) {
  const txt = String(raw || "").trim();
  if (!txt) return "";

  const parts = txt.split(/[,\s/|]+/).filter(Boolean);
  const candidate = parts.find((p) => /\d/.test(p)) || txt;

  let cleaned = candidate.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+")) {
    cleaned = `+${cleaned.slice(1).replace(/[^\d]/g, "")}`;
  } else {
    cleaned = cleaned.replace(/[^\d]/g, "");
  }

  return cleaned;
}

async function sendInvoiceBySMS() {
  try {
    if (!state.user) return alert("Login requerido.");

    readDocHeaderIntoState();
    updateTotalsLive();

    const phone = extractPhoneFromContact(state.current.client?.contact || "");
    if (!phone) return alert("El contacto del cliente no tiene un número válido.");

    const pdfUrl = await uploadInvoicePdfAndGetUrl();
    const label = state.current.type === "FAC" ? "factura" : "cotización";
    const msg =
      `Hola ${state.current.client?.name || ""}, te compartimos tu ${label} ${state.current.number || ""} por ${fmtMoney(state.current.totals?.grand || 0)}. PDF: ${pdfUrl}`.trim();

    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const smsUrl = isIOS
      ? `sms:${phone};?&body=${encodeURIComponent(msg)}`
      : `sms:${phone}?body=${encodeURIComponent(msg)}`;

    window.location.href = smsUrl;
  } catch (err) {
    console.error("SMS falló:", err);
    alert("No se pudo preparar el mensaje con el PDF.");
  }
}

function openPaymentLink() {
  const link = String(state.cfg?.biz?.paymentLink || "").trim();
  if (!link) return alert("No hay enlace de pago configurado.");
  window.open(link, "_blank", "noopener,noreferrer");
}

function bindEvents() {
  document.querySelectorAll(".bottomLink").forEach((b) => {
    b.addEventListener("click", () => setView(b.dataset.view));
  });

  $("btnQuickQuote")?.addEventListener("click", () => {
    state.activeDocId = null;
    state.current = newDoc("COT");
    cacheSave();
    renderInvoicing();
    setView("invoicing");
  });

  $("btnQuickInvoice")?.addEventListener("click", () => {
    state.activeDocId = null;
    state.current = newDoc("FAC");
    cacheSave();
    renderInvoicing();
    setView("invoicing");
  });

  $("btnSettings")?.addEventListener("click", openBiz);
  $("btnOpenConfig")?.addEventListener("click", openBiz);
  $("btnCloseBiz")?.addEventListener("click", closeBiz);
  $("btnSaveBiz")?.addEventListener("click", saveBiz);
  $("btnOpenPaymentLink")?.addEventListener("click", openPaymentLink);

  $("btnToggleCustomerForm")?.addEventListener("click", () => toggleCustomerForm());
  $("btnCancelCustomerForm")?.addEventListener("click", () => toggleCustomerForm(false));
  $("btnAddCustomer")?.addEventListener("click", saveCustomer);

  $("cSearch")?.addEventListener("input", () => {
    updateCustomerSearchClear();
    renderCustomers();
  });

  $("btnClearCustomerSearch")?.addEventListener("click", () => {
    $("cSearch").value = "";
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
    $(id)?.addEventListener("input", () => {
      readDocHeaderIntoState();
      updateTotalsLive();
      cacheSave();
    });

    $(id)?.addEventListener("change", () => {
      readDocHeaderIntoState();
      updateTotalsLive();
      cacheSave();
    });
  });

  $("btnAddItem")?.addEventListener("click", () => {
    state.current.items.push(emptyItem());
    renderItemsMobile();
    updateTotalsLive();
    cacheSave();
  });

  $("btnSaveDoc")?.addEventListener("click", async () => {
    try {
      await saveCurrentToHistory();
      alert("Guardado ✅");
    } catch (err) {
      console.error(err);
      alert("No se pudo guardar.");
    }
  });

  $("btnPDF")?.addEventListener("click", confirmPDF);
  $("btnSMS")?.addEventListener("click", sendInvoiceBySMS);
  $("btnConfirmFromPreview")?.addEventListener("click", confirmPDF);
  $("btnRefreshPreview")?.addEventListener("click", () => {});
  $("btnDuplicate")?.addEventListener("click", duplicateDoc);
  $("btnDelete")?.addEventListener("click", deleteDocCloud);

  $("histSearch")?.addEventListener("input", renderHistory);

  $("btnExportHist")?.addEventListener("click", async () => {
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

    state.docs = [];
    state.activeDocId = null;
    state.current = newDoc("FAC");
    cacheSave();
    await loadAllFromFirestore();
  });

  $("btnExportBackup")?.addEventListener("click", async () => {
    try {
      await exportBackupFile();
    } catch (err) {
      console.error(err);
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

function bootFromCacheOrDefault() {
  cacheLoad();

  if (!state.current) state.current = newDoc("FAC");
  if (!state.current.type) state.current.type = "FAC";

  refreshAllUI();
  syncFormFromState();
  renderItemsMobile();
  updateTotalsLive();
  toggleCustomerForm(false);
  updateCustomerSearchClear();
}

function boot() {
  ensureAuthButtons();
  bindEvents();
  hideSplashScreen();

  bootFromCacheOrDefault();
  setView("invoicing");

  onAuthStateChanged(auth, async (user) => {
    state.user = user || null;
    refreshAuthUI();

    if (state.user) {
      try {
        await loadAllFromFirestore();
      } catch (err) {
        console.error("Sync falló, sigo con cache local:", err);
        cacheLoad();
        refreshAllUI();
      }
    } else {
      cacheLoad();
      refreshAllUI();
    }

    if (!state.current) state.current = newDoc("FAC");
    if (!state.current.type) state.current.type = "FAC";

    syncFormFromState();
    renderItemsMobile();
    updateTotalsLive();
    cacheSave();
  });
}

document.addEventListener("DOMContentLoaded", boot);

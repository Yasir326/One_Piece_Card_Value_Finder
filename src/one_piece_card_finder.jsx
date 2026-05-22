import { useState, useEffect, useRef } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

const OPTCG_BASE = "https://www.optcgapi.com";

// PayPal.me or PayPal donate URL — set VITE_PAYPAL_DONATE_URL in .env (see .env.example)
const PAYPAL_DONATE_URL = import.meta.env.VITE_PAYPAL_DONATE_URL?.trim() || "";

const ENDPOINTS = {
  sets: "/api/sets",
  decks: "/api/decks",
  promos: "/api/promos",
  don: "/api/don",
};

const RARITY_LABELS = {
  C: "Common",
  UC: "Uncommon",
  R: "Rare",
  SR: "Super Rare",
  SEC: "Secret Rare",
  L: "Leader",
  P: "Promo",
  DON: "Promo",
};

const toPrice = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const CARD_NUMBER_RE = /^[A-Z]{1,4}\d{0,2}-\d{3}$/;

function normalizeCardNumber(query) {
  return query.trim().toUpperCase().replace(/\s+/g, "");
}

function normalizeCard(raw, source) {
  const market = toPrice(raw?.market_price);
  const inventory = toPrice(raw?.inventory_price);
  const rarity = RARITY_LABELS[raw?.rarity] ?? raw?.rarity ?? "Common";
  const cardNumber = raw?.card_set_id ?? raw?.card_number ?? "";
  const image = raw?.card_image ?? raw?.image ?? null;
  const title = raw?.card_name ?? raw?.name ?? "Unknown Card";
  const imageId = raw?.card_image_id ?? "";

  return {
    name: title,
    set_name: raw?.set_name ?? raw?.episode ?? "Unknown Set",
    card_number: cardNumber,
    region: "EN",
    rarity,
    current_price: market,
    inventory_price: inventory,
    change_pct: inventory > 0 ? ((market - inventory) / inventory) * 100 : 0,
    image_url: image,
    image_id: imageId,
    source,
    pricecharting_url: null,
    description: raw?.card_text ?? "",
  };
}

function extractCardNumberFromTitle(title = "") {
  const match = title.match(/\b(OP|ST|EB|P|PRB)(\d{2})-(\d{3}[A-Z]?)\b/i);
  if (!match) return "";
  return `${match[1].toUpperCase()}${match[2]}-${match[3].toUpperCase()}`;
}

function inferRarityFromTitle(title = "") {
  const t = title.toLowerCase();
  if (/secret|\bsec\b/.test(t)) return "Secret Rare";
  if (/super rare|\bsr\b|\[sp\]|sp gold|sp silver/.test(t)) return "Super Rare";
  if (/\bleader\b|\[l\]/.test(t)) return "Leader";
  if (/manga/.test(t)) return "Secret Rare";
  if (/promo|\bp-\d/.test(t)) return "Promo";
  if (/alternate art|alt art/.test(t)) return "Super Rare";
  return "Rare";
}

function normalizePriceChartingCard(row) {
  const price = toPrice(row?.ungraded);
  const region = row?.region ?? (/japanese/i.test(row?.setName ?? "") ? "JP" : "EN");
  return {
    name: row?.title ?? "Unknown Card",
    set_name: row?.setName ?? "Unknown Set",
    card_number: row?.cardNumber ?? extractCardNumberFromTitle(row?.title ?? ""),
    region,
    rarity: inferRarityFromTitle(row?.title ?? ""),
    current_price: price,
    inventory_price: price,
    change_pct: 0,
    image_url: row?.imageUrl ?? null,
    image_id: "",
    source: "pricecharting",
    pricecharting_url: row?.url ?? null,
    description: "",
  };
}

async function fetchJson(path, params = {}) {
  const url = new URL(path, OPTCG_BASE);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Failed request: ${res.status}`);
  return res.json();
}

function dedupeCards(cards) {
  const map = new Map();
  cards.forEach((card) => {
    const key = `${card.region ?? "EN"}|${card.card_number}|${card.name}|${card.pricecharting_url ?? card.image_id ?? ""}`;
    if (!map.has(key)) map.set(key, card);
  });
  return Array.from(map.values());
}

function buildHistoryFromTwoWeeks(historyRow) {
  if (!historyRow) return [];

  const points = [];
  for (let day = 13; day >= 1; day -= 1) {
    const price = toPrice(historyRow[`Day${day}_Market_Price`]);
    if (price > 0) {
      points.push({ month: `D-${day}`, price });
    }
  }
  return points;
}

function buildRecentSales(historyRow) {
  if (!historyRow) return [];
  const rows = [];
  const now = new Date();

  for (let day = 1; day <= 13; day += 1) {
    const price = toPrice(historyRow[`Day${day}_Market_Price`]);
    if (price <= 0) continue;
    const date = new Date(now);
    date.setDate(now.getDate() - day);
    rows.push({
      date: date.toISOString().slice(0, 10),
      price,
      source: "OPTCG API",
    });
  }

  return rows.slice(0, 8);
}

function formatUsd(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "N/A";
  return `$${n.toFixed(2)}`;
}

async function fetchGradedPrices(card, expectedRawPrice = null, { region = "EN" } = {}) {
  const params = new URLSearchParams({
    cardName: card?.name ?? "",
    setName: card?.set_name ?? "",
    cardNumber: card?.card_number ?? "",
    imageId: card?.image_id ?? "",
    region,
  });
  if (Number.isFinite(Number(expectedRawPrice)) && Number(expectedRawPrice) > 0) {
    params.set("expectedRawPrice", String(Number(expectedRawPrice)));
  }
  if (card?.pricecharting_url) {
    params.set("sourceUrl", card.pricecharting_url);
  }

  const res = await fetch(`/api/graded-prices?${params.toString()}`);
  if (!res.ok) throw new Error(`Graded fetch failed: ${res.status}`);
  const data = await res.json();
  if (!data?.ok || !data?.found || !data?.prices) return null;
  return {
    source_url: data.sourceUrl ?? null,
    source_title: data.title ?? null,
    prices: data.prices,
    confidence: Number(data.confidence ?? 0),
    verified: Boolean(data.verified),
    matched_by: data.matchedBy ?? null,
  };
}

async function fetchPriceChartingSearch(query, { region = "jp" } = {}) {
  const q = query.trim();
  if (!q) return [];
  const params = new URLSearchParams({ q, region });
  const res = await fetch(`/api/pricecharting/search?${params.toString()}`);
  if (!res.ok) return [];
  const data = await res.json();
  if (!data?.ok) return [];
  return (data.cards ?? []).map(normalizePriceChartingCard);
}

async function fetchTopJapaneseCards() {
  const res = await fetch("/api/pricecharting/top-japanese");
  if (!res.ok) return [];
  const data = await res.json();
  if (!data?.ok) return [];
  return (data.cards ?? [])
    .map(normalizePriceChartingCard)
    .filter((card) => card.current_price > 0)
    .slice(0, 10)
    .map((card, idx) => ({ ...card, rank: idx + 1 }));
}

async function fetchTopCards() {
  const sources = [
    { source: "sets", path: "/api/allSetCards/" },
    { source: "decks", path: "/api/allSTCards/" },
    { source: "promos", path: "/api/allPromoCards/" },
    { source: "don", path: "/api/allDonCards/" },
  ];

  const lists = await Promise.all(
    sources.map(async ({ source, path }) => {
      try {
        const data = await fetchJson(path);
        return Array.isArray(data) ? data.map((row) => normalizeCard(row, source)) : [];
      } catch {
        return [];
      }
    })
  );

  return dedupeCards(lists.flat())
    .filter((card) => card.current_price > 0)
    .sort((a, b) => b.current_price - a.current_price)
    .slice(0, 10)
    .map((card, idx) => ({ ...card, rank: idx + 1 }));
}

async function searchCards(query, { limit = 6 } = {}) {
  const q = query.trim();
  if (!q) return [];
  const qCardNumber = normalizeCardNumber(q);
  const isCardNumber = CARD_NUMBER_RE.test(qCardNumber);

  const sources = Object.entries(ENDPOINTS);
  const [lists, jpCards] = await Promise.all([
    Promise.all(
      sources.map(async ([source, base]) => {
        try {
          const responses = await Promise.all([
            fetchJson(`${base}/filtered/`, { card_name: q }).catch(() => []),
            isCardNumber ? fetchJson(`${base}/card/${qCardNumber}/`).catch(() => []) : Promise.resolve([]),
          ]);

          return responses
            .flatMap((rows) => (Array.isArray(rows) ? rows : []))
            .map((row) => normalizeCard(row, source));
        } catch {
          return [];
        }
      })
    ),
    fetchPriceChartingSearch(isCardNumber ? qCardNumber : q, { region: "jp" }).catch(() => []),
  ]);

  const normalizedQ = q.toLowerCase();
  const deduped = dedupeCards([...lists.flat(), ...jpCards])
    .sort((a, b) => {
      const aCard = String(a.card_number ?? "").toUpperCase();
      const bCard = String(b.card_number ?? "").toUpperCase();
      const aExactCard = aCard === qCardNumber ? 1 : 0;
      const bExactCard = bCard === qCardNumber ? 1 : 0;
      if (aExactCard !== bExactCard) return bExactCard - aExactCard;

      const aCardStarts = aCard.startsWith(qCardNumber) ? 1 : 0;
      const bCardStarts = bCard.startsWith(qCardNumber) ? 1 : 0;
      if (aCardStarts !== bCardStarts) return bCardStarts - aCardStarts;

      const aStarts = a.name.toLowerCase().startsWith(normalizedQ) ? 1 : 0;
      const bStarts = b.name.toLowerCase().startsWith(normalizedQ) ? 1 : 0;
      if (aStarts !== bStarts) return bStarts - aStarts;
      return b.current_price - a.current_price;
    });

  return Number.isFinite(limit) ? deduped.slice(0, limit) : deduped;
}

async function fetchPriceChartingDetail(card) {
  const graded = await fetchGradedPrices(card, card.current_price, { region: "JP" }).catch(() => null);
  const gradedPrices = graded?.prices ?? {};
  const rawPrice = gradedPrices.raw_market_price ?? card.current_price ?? 0;

  return {
    ...card,
    image_url: graded?.image_url ?? card.image_url ?? null,
    avg_price_30d: rawPrice,
    price_low: rawPrice,
    price_high: rawPrice,
    raw_market_price: rawPrice,
    raw_listing_price: gradedPrices.raw_listing_price ?? rawPrice,
    graded_prices: {
      psa9: gradedPrices.psa9 ?? null,
      psa10: gradedPrices.psa10 ?? null,
      cgc10: gradedPrices.cgc10 ?? null,
      cgc10Pristine: gradedPrices.cgc10Pristine ?? null,
      bgs10Pristine: gradedPrices.bgs10Pristine ?? null,
      bgs10BlackLabel: gradedPrices.bgs10BlackLabel ?? null,
    },
    graded_source_url: graded?.source_url ?? card.pricecharting_url ?? null,
    graded_source_title: graded?.source_title ?? card.name,
    graded_confidence: graded?.confidence ?? (card.pricecharting_url ? 1 : 0),
    graded_verified: Boolean(graded?.verified ?? card.pricecharting_url),
    graded_matched_by: graded?.matched_by ?? (card.pricecharting_url ? "direct-url" : null),
    recent_sales: [],
    price_history: [],
    history_unavailable: true,
    japanese_editions: [],
  };
}

async function fetchDetail(card) {
  if (card.source === "pricecharting" || card.region === "JP") {
    return fetchPriceChartingDetail(card);
  }

  const base = ENDPOINTS[card.source] ?? ENDPOINTS.sets;
  const id = card.card_number;
  const [detailRows, historyResponse] = await Promise.all([
    fetchJson(`${base}/card/${id}/`).catch(() => []),
    fetchJson(`${base}/card/twoweeks/${id}/`)
      .then((data) => ({ failed: false, data }))
      .catch(() => ({ failed: true, data: [] })),
  ]);

  const rows = Array.isArray(detailRows) ? detailRows : [];
  const variants = rows.map((row) => normalizeCard(row, card.source));
  const selectedVariant =
    variants.find((row) => row.image_id && row.image_id === card.image_id) ||
    variants.find((row) => row.image_url && row.image_url === card.image_url) ||
    variants.find((row) => row.name?.toLowerCase() === card.name?.toLowerCase()) ||
    variants.sort((a, b) => b.current_price - a.current_price)[0];

  const marketPrices = rows.map((row) => toPrice(row.market_price)).filter((price) => price > 0);
  const historyRows = Array.isArray(historyResponse?.data) ? historyResponse.data : [];
  const twoWeekRow = historyRows.length > 0 ? historyRows[0] : null;
  const history = buildHistoryFromTwoWeeks(twoWeekRow);
  const graded = await fetchGradedPrices(selectedVariant ?? card, selectedVariant?.current_price ?? card?.current_price, { region: "EN" }).catch(() => null);
  const gradedPrices = graded?.prices ?? {};
  const japaneseEditions = await fetchPriceChartingSearch(
    card.card_number || card.name,
    { region: "jp" }
  )
    .then((rows) => rows.filter((row) => !card.card_number || row.card_number === card.card_number))
    .catch(() => []);

  return {
    ...(selectedVariant ?? card),
    avg_price_30d: marketPrices.length ? marketPrices.reduce((a, b) => a + b, 0) / marketPrices.length : (selectedVariant?.current_price ?? 0),
    price_low: marketPrices.length ? Math.min(...marketPrices) : (selectedVariant?.inventory_price ?? 0),
    price_high: marketPrices.length ? Math.max(...marketPrices) : (selectedVariant?.current_price ?? 0),
    raw_market_price: gradedPrices.raw_market_price ?? selectedVariant?.current_price ?? 0,
    raw_listing_price: gradedPrices.raw_listing_price ?? selectedVariant?.inventory_price ?? 0,
    graded_prices: {
      psa9: gradedPrices.psa9 ?? null,
      psa10: gradedPrices.psa10 ?? null,
      cgc10: gradedPrices.cgc10 ?? null,
      cgc10Pristine: gradedPrices.cgc10Pristine ?? null,
      bgs10Pristine: gradedPrices.bgs10Pristine ?? null,
      bgs10BlackLabel: gradedPrices.bgs10BlackLabel ?? null,
    },
    graded_source_url: graded?.source_url ?? null,
    graded_source_title: graded?.source_title ?? null,
    graded_confidence: graded?.confidence ?? 0,
    graded_verified: Boolean(graded?.verified),
    graded_matched_by: graded?.matched_by ?? null,
    recent_sales: buildRecentSales(twoWeekRow),
    price_history: history,
    history_unavailable: Boolean(historyResponse?.failed),
    japanese_editions: japaneseEditions,
  };
}

const RARITY = {
  Common:       { color: "#64748b", dim: "#e2e8f0" },
  Uncommon:     { color: "#059669", dim: "#d1fae5" },
  Rare:         { color: "#2563eb", dim: "#dbeafe" },
  "Super Rare": { color: "#d97706", dim: "#fef3c7" },
  "Secret Rare":{ color: "#9333ea", dim: "#f3e8ff" },
  Leader:       { color: "#dc2626", dim: "#fee2e2" },
  Promo:        { color: "#ea580c", dim: "#ffedd5" },
};
const R = (r) => RARITY[r] ?? RARITY["Common"];

function PayPalIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M7.076 21.337H2.47a.641.641 0 0 1-.633-.74L4.944 2.901A.641.641 0 0 1 5.577 2.4h7.06c2.34 0 4.035.487 5.038 1.448.96.92 1.298 2.25 1.005 3.96-.028.17-.06.34-.094.513-.312 1.678-.98 3.082-1.984 4.173-1.002 1.088-2.3 1.88-3.86 2.355-1.498.456-3.22.687-5.12.687H9.74l-.664 4.074zm1.065-2.674h2.08c1.55 0 2.755-.28 3.58-.84.824-.56 1.38-1.42 1.665-2.58.285-1.16.24-2.04-.135-2.64-.375-.6-1.14-.9-2.295-.9H9.05l-.91 5.96z" />
    </svg>
  );
}

function DonateLink({ compact = false }) {
  if (!PAYPAL_DONATE_URL) return null;

  return (
    <a
      href={PAYPAL_DONATE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="hov-donate"
      title="Support this app via PayPal"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: compact ? 5 : 7,
        padding: compact ? "6px 11px" : "9px 16px",
        borderRadius: 8,
        border: "1px solid #0070ba44",
        background: compact ? "#ffffff" : "linear-gradient(180deg, #ffffff 0%, #f0f7ff 100%)",
        color: "#003087",
        fontSize: compact ? 11 : 13,
        fontWeight: 600,
        textDecoration: "none",
        fontFamily: "inherit",
        flexShrink: 0,
        transition: "all .15s",
        boxShadow: compact ? "none" : "0 1px 3px rgba(0,48,135,0.08)",
      }}
    >
      <PayPalIcon size={compact ? 14 : 16} />
      {compact ? "Support" : "Donate with PayPal"}
    </a>
  );
}

function DonateFooter() {
  if (!PAYPAL_DONATE_URL) return null;

  return (
    <footer style={{
      marginTop: 48,
      padding: "28px 28px 36px",
      borderTop: "1px solid #d0dae8",
      background: "rgba(255,255,255,0.6)",
    }}>
      <div style={{
        maxWidth: 1020,
        margin: "0 auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 20,
        flexWrap: "wrap",
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#1e293b", marginBottom: 4 }}>
            Found this useful?
          </div>
          <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5, maxWidth: 420 }}>
            Card prices and images are pulled from public APIs. A small donation helps keep the app running.
          </div>
        </div>
        <DonateLink />
      </div>
    </footer>
  );
}

function RegionBadge({ region = "EN" }) {
  const isJp = region === "JP";
  return (
    <span style={{
      fontSize: 9,
      letterSpacing: 0.8,
      textTransform: "uppercase",
      padding: "2px 7px",
      borderRadius: 10,
      border: `1px solid ${isJp ? "#fca5a5" : "#93c5fd"}`,
      background: isJp ? "#fef2f2" : "#eff6ff",
      color: isJp ? "#b91c1c" : "#1d4ed8",
      fontWeight: 700,
      flexShrink: 0,
    }}>
      {isJp ? "JP" : "EN"}
    </span>
  );
}

function CardArt({ name = "", rarity = "Common", cardNumber = "", imageUrl = null, w = 80, h = 112 }) {
  const rc = R(rarity);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [imageUrl]);

  if (imageUrl && !imgError) {
    return (
      <img
        src={imageUrl}
        alt={name}
        width={w}
        height={h}
        loading="lazy"
        onError={() => setImgError(true)}
        style={{
          width: w,
          height: h,
          borderRadius: 6,
          objectFit: "cover",
          flexShrink: 0,
          display: "block",
          border: `1px solid ${rc.color}50`,
          background: "#f1f5f9",
        }}
      />
    );
  }

  const uid = `c${name.split("").reduce((a, c) => (a * 31 + c.charCodeAt(0)) & 0xffff, 0)}`;
  const words = name.split(" ");
  const lines = [];
  let cur = "";
  words.forEach((word) => {
    const test = cur ? `${cur} ${word}` : word;
    if (test.length > 11 && cur) { lines.push(cur); cur = word; }
    else cur = test;
  });
  if (cur) lines.push(cur);
  const fs = w < 90 ? 8 : 11;
  const lineH = fs + 3;

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ borderRadius: 6, flexShrink: 0, display: "block" }}>
      <defs>
        <linearGradient id={`${uid}bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={rc.dim} />
          <stop offset="100%" stopColor="#e2e8f0" />
        </linearGradient>
        <linearGradient id={`${uid}sh`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.07)" />
          <stop offset="50%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
      </defs>
      <rect width={w} height={h} rx="5" fill={`url(#${uid}bg)`} />
      <rect width={w} height={h} rx="5" fill={`url(#${uid}sh)`} />
      <rect width={w} height={h} rx="5" fill="none" stroke={rc.color} strokeWidth="1.2" strokeOpacity="0.45" />
      <path d={`M0 ${h*0.28} Q${w*.25} ${h*0.25} ${w*.5} ${h*0.28} Q${w*.75} ${h*0.31} ${w} ${h*0.28}`}
        fill="none" stroke={rc.color} strokeWidth="0.5" strokeOpacity="0.18" />
      <path d={`M0 ${h*0.65} Q${w*.25} ${h*0.62} ${w*.5} ${h*0.65} Q${w*.75} ${h*0.68} ${w} ${h*0.65}`}
        fill="none" stroke={rc.color} strokeWidth="0.5" strokeOpacity="0.18" />
      <text x={w / 2} y={h * 0.5} textAnchor="middle" fontSize={w * 0.28}
        fill={rc.color} fillOpacity="0.06" fontFamily="serif">☠</text>
      {lines.map((ln, i) => (
        <text key={i}
          x={w / 2}
          y={h * 0.5 + (i - (lines.length - 1) / 2) * lineH}
          textAnchor="middle"
          fontSize={fs}
          fontWeight="700"
          fill={rc.color}
          fontFamily="Georgia, serif"
          letterSpacing="0.3">
          {ln}
        </text>
      ))}
      <rect x={w * 0.06} y={h * 0.84} width={w * 0.88} height={h * 0.1} rx="2"
        fill={rc.color} fillOpacity="0.14" />
      <text x={w / 2} y={h * 0.915} textAnchor="middle" fontSize={fs * 0.65}
        fill={rc.color} fontFamily="monospace" letterSpacing="0.8">
        {(rarity ?? "").toUpperCase().substring(0, 9)}
      </text>
      <text x={w / 2} y={h * 0.975} textAnchor="middle" fontSize={fs * 0.6}
        fill="#64748b" fontFamily="monospace">
        {cardNumber}
      </text>
    </svg>
  );
}

function Skeleton({ w = "100%", h = 64 }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: 8,
      background: "linear-gradient(90deg,#e2e8f0 25%,#f1f5f9 50%,#e2e8f0 75%)",
      backgroundSize: "400% 100%",
      animation: "shimmer 1.6s ease infinite",
    }} />
  );
}

function StatCard({ label, value, accent, big }) {
  return (
    <div style={{
      background: "#ffffff",
      border: `1px solid ${big ? accent + "45" : "#d0dae8"}`,
      borderRadius: 8, padding: "12px 14px",
    }}>
      <div style={{ fontSize: 10, color: "#64748b", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 5 }}>
        {label}
      </div>
      <div style={{ fontSize: big ? 26 : 17, fontWeight: 700, color: big ? accent : "#1e293b" }}>
        {value}
      </div>
    </div>
  );
}

export default function App() {
  const [view, setView]               = useState("home");
  const [query, setQuery]             = useState("");
  const [results, setResults]         = useState([]);
  const [submittedResults, setSubmittedResults] = useState([]);
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [searchingAll, setSearchingAll] = useState(false);
  const [showDrop, setShowDrop]       = useState(false);
  const [searching, setSearching]     = useState(false);
  const [topCards, setTopCards]       = useState([]);
  const [topCardsJp, setTopCardsJp]   = useState([]);
  const [loadingTop, setLoadingTop]   = useState(true);
  const [loadingTopJp, setLoadingTopJp] = useState(true);
  const [detail, setDetail]           = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [selectedCard, setSelectedCard]   = useState(null);
  const debounceRef = useRef(null);
  const searchRef   = useRef(null);
  const searchSeqRef = useRef(0);

  useEffect(() => {
    (async () => {
      try {
        const [en, jp] = await Promise.all([
          fetchTopCards(),
          fetchTopJapaneseCards(),
        ]);
        setTopCards(Array.isArray(en) ? en : []);
        setTopCardsJp(Array.isArray(jp) ? jp : []);
      } finally {
        setLoadingTop(false);
        setLoadingTopJp(false);
      }
    })();
  }, []);

  const handleSearch = (e) => {
    const q = e.target.value;
    const nextSeq = searchSeqRef.current + 1;
    searchSeqRef.current = nextSeq;
    setQuery(q);
    setSubmittedQuery("");
    setSubmittedResults([]);
    clearTimeout(debounceRef.current);
    if (!q.trim()) { setResults([]); setShowDrop(false); setSearchingAll(false); return; }
    const searchText = q.trim();
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await searchCards(searchText);
        if (searchSeqRef.current !== nextSeq) return;
        setResults(Array.isArray(data) ? data : []);
        setShowDrop(true);
      } finally {
        if (searchSeqRef.current === nextSeq) {
          setSearching(false);
        }
      }
    }, 420);
  };

  const submitSearch = async () => {
    const q = query.trim();
    if (!q) return;
    const submitSeq = searchSeqRef.current + 1;
    searchSeqRef.current = submitSeq;
    clearTimeout(debounceRef.current);
    setView("home");
    setShowDrop(false);
    setSearching(true);
    setSearchingAll(true);
    try {
      const data = await searchCards(q, { limit: Number.POSITIVE_INFINITY });
      if (searchSeqRef.current !== submitSeq) return;
      const allMatches = Array.isArray(data) ? data : [];
      setResults(allMatches.slice(0, 6));
      setSubmittedResults(allMatches);
      setSubmittedQuery(q);
    } finally {
      if (searchSeqRef.current === submitSeq) {
        setSearching(false);
        setSearchingAll(false);
      }
    }
  };

  const selectCard = async (card) => {
    searchSeqRef.current += 1;
    clearTimeout(debounceRef.current);
    setShowDrop(false);
    setSearching(false);
    setQuery(card.name);
    setSelectedCard(card);
    setView("detail");
    setLoadingDetail(true);
    setDetail(null);
    try {
      const data = await fetchDetail(card);
      setDetail(data);
    } finally {
      setLoadingDetail(false);
    }
  };

  const goHome = () => {
    setView("home");
    setQuery("");
    setResults([]);
    setSubmittedResults([]);
    setSubmittedQuery("");
    setSearchingAll(false);
    setSelectedCard(null);
    setDetail(null);
  };

  useEffect(() => {
    const h = (e) => { if (!searchRef.current?.contains(e.target)) setShowDrop(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@700;900&family=Outfit:wght@400;500;600&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        html,body{background:#f0f4fa;color:#1e293b}
        @keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{opacity:.5}50%{opacity:1}}
        input::placeholder{color:#94a3b8}
        ::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:#eef2f8}::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:3px}
        .hov-row:hover{background:#eef2f8!important;border-color:var(--ac)!important;transform:translateY(-1px);box-shadow:0 4px 12px rgba(15,23,42,0.06)}
        .hov-drop:hover{background:#eef2f8!important}
        .hov-back:hover{border-color:#94a3b8!important;color:#1e293b!important;background:#f8fafc!important}
        .hov-donate:hover{background:#0070ba!important;color:#ffffff!important;border-color:#0070ba!important;transform:translateY(-1px);box-shadow:0 4px 12px rgba(0,112,186,0.25)!important}
      `}</style>

      <div style={{ minHeight: "100vh", background: "#f0f4fa", fontFamily: "'Outfit', sans-serif", color: "#1e293b" }}>
        {/* grid bg */}
        <div style={{ position: "fixed", inset: 0, opacity: 0.045, pointerEvents: "none",
          backgroundImage: "linear-gradient(#c4860f 1px,transparent 1px),linear-gradient(90deg,#c4860f 1px,transparent 1px)",
          backgroundSize: "48px 48px" }} />

        {/* Header */}
        <header style={{ position: "sticky", top: 0, zIndex: 100,
          background: "rgba(255,255,255,0.92)", backdropFilter: "blur(14px)",
          borderBottom: "1px solid #d0dae8", padding: "14px 28px",
          display: "flex", alignItems: "center", gap: 20, boxShadow: "0 1px 0 rgba(15,23,42,0.04)" }}>

          <div onClick={goHome} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <span style={{ fontSize: 20 }}>☠️</span>
            <div>
              <div style={{ fontFamily: "'Cinzel',serif", fontSize: 14, fontWeight: 900,
                color: "#b45309", letterSpacing: 2, lineHeight: 1 }}>ONE PIECE</div>
              <div style={{ fontSize: 8, color: "#64748b", letterSpacing: 3.5, textTransform: "uppercase" }}>Card Value Finder</div>
            </div>
          </div>

          {/* Search */}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <DonateLink compact />
          <div ref={searchRef} style={{ position: "relative", width: "min(440px,100%)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8,
              background: "#ffffff", border: "1px solid #d0dae8", borderRadius: 8, padding: "9px 14px", boxShadow: "0 1px 3px rgba(15,23,42,0.04)" }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              <input value={query} onChange={handleSearch}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitSearch();
                  }
                }}
                onFocus={() => results.length > 0 && setShowDrop(true)}
                placeholder='Search cards... try "lufy gear 5" or "OP06-001"'
                style={{ flex: 1, background: "none", border: "none", outline: "none",
                  color: "#1e293b", fontSize: 13, fontFamily: "inherit" }} />
              {searching
                ? <div style={{ width: 13, height: 13, border: "2px solid #b45309",
                    borderTopColor: "transparent", borderRadius: "50%", animation: "spin .7s linear infinite" }} />
                : query && <span onClick={() => { setQuery(""); setResults([]); setShowDrop(false); setSubmittedResults([]); setSubmittedQuery(""); }}
                    style={{ color: "#94a3b8", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</span>}
            </div>

            {showDrop && results.length > 0 && (
              <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0,
                background: "#ffffff", border: "1px solid #d0dae8", borderRadius: 8,
                overflow: "hidden", zIndex: 200, boxShadow: "0 12px 32px rgba(15,23,42,0.12)",
                animation: "fadeUp .15s ease" }}>
                {results.map((card, i) => {
                  const cr = R(card.rarity);
                  return (
                    <div
                      key={`${card.card_number}-${card.source}-${i}`}
                      className="hov-drop"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        selectCard(card);
                      }}
                      style={{ padding: "10px 14px", cursor: "pointer", display: "flex",
                        alignItems: "center", gap: 12, background: "transparent",
                        borderBottom: i < results.length - 1 ? "1px solid #e8edf4" : "none",
                        transition: "background .15s" }}>
                      <CardArt name={card.name} rarity={card.rarity} cardNumber={card.card_number} imageUrl={card.image_url} w={42} h={59} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#1e293b",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.name}</div>
                          <RegionBadge region={card.region} />
                        </div>
                        <div style={{ fontSize: 11, color: "#64748b" }}>{card.card_number} · {card.set_name}</div>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: cr.color, flexShrink: 0 }}>
                        ${Number(card.current_price ?? 0).toFixed(2)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          </div>
        </header>

        <main style={{ padding: "32px 28px", maxWidth: 1020, margin: "0 auto" }}>
          {view === "home"
            ? <HomeView
                topCards={topCards}
                topCardsJp={topCardsJp}
                loading={loadingTop}
                loadingJp={loadingTopJp}
                searchResults={submittedResults}
                searchQuery={submittedQuery}
                searchingAll={searchingAll}
                onSelect={selectCard}
              />
            : <DetailView card={selectedCard} detail={detail} loading={loadingDetail} onBack={goHome} onSelect={selectCard} />}
        </main>
        <DonateFooter />
      </div>
    </>
  );
}

function TopCardRow({ card, index, showingSearch, onSelect }) {
  const cr = R(card.rarity);
  const up = (card.change_pct ?? 0) >= 0;
  const hasChange = card.region !== "JP" && Number.isFinite(card.change_pct);

  return (
    <div className="hov-row" onClick={() => onSelect(card)}
      style={{ "--ac": cr.color, background: "#ffffff", border: "1px solid #d0dae8",
        borderRadius: 10, padding: "11px 16px", display: "flex", alignItems: "center",
        gap: 13, cursor: "pointer", transition: "all .18s",
        boxShadow: "0 1px 3px rgba(15,23,42,0.04)",
        animation: `fadeUp .3s ease ${index * 0.035}s both` }}>
      <div style={{ width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
        background: `${cr.color}12`, border: `1px solid ${cr.color}28`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 10, fontWeight: 700, color: cr.color }}>
        {showingSearch ? "↗" : (card.rank ?? index + 1)}
      </div>
      <CardArt name={card.name} rarity={card.rarity} cardNumber={card.card_number} imageUrl={card.image_url} w={50} h={70} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#1e293b",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {card.name}
          </div>
          <RegionBadge region={card.region} />
        </div>
        <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
          {card.card_number}{card.card_number ? " · " : ""}
          <span style={{ color: cr.color }}>{card.rarity}</span>
          {card.set_name ? ` · ${card.set_name}` : ""}
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#1e293b" }}>
          ${Number(card.current_price ?? 0).toFixed(2)}
        </div>
        {hasChange ? (
          <div style={{ fontSize: 11, color: up ? "#059669" : "#dc2626", marginTop: 1 }}>
            {up ? "▲" : "▼"} {Math.abs(card.change_pct ?? 0).toFixed(1)}%
          </div>
        ) : (
          <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>PriceCharting</div>
        )}
      </div>
    </div>
  );
}

function SectionHeader({ title, badge }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, marginTop: badge === "JP" ? 36 : 0 }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="#b45309"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
      <span style={{ fontFamily: "'Cinzel',serif", fontSize: 16, color: "#b45309" }}>{title}</span>
      <div style={{ flex: 1, height: 1, background: "linear-gradient(90deg,#d0dae8,transparent)" }} />
      <span style={{ fontSize: 10, color: "#94a3b8", letterSpacing: 2 }}>{badge}</span>
    </div>
  );
}

function HomeView({ topCards, topCardsJp, loading, loadingJp, searchResults, searchQuery, searchingAll, onSelect }) {
  const showingSearch = Boolean(searchQuery.trim());

  return (
    <div>
      <div style={{ textAlign: "center", padding: "36px 0 52px" }}>
        <div style={{ fontSize: 10, letterSpacing: 5, color: "#64748b", textTransform: "uppercase", marginBottom: 10 }}>
          Real-Time Market Data
        </div>
        <h1 style={{ fontFamily: "'Cinzel',serif", fontSize: 36, fontWeight: 900,
          color: "#b45309", letterSpacing: 1, lineHeight: 1.15,
          textShadow: "0 2px 12px rgba(180,83,9,0.15)", marginBottom: 10 }}>
          Find Your Card's Value
        </h1>
        <p style={{ color: "#64748b", fontSize: 14, maxWidth: 480, margin: "0 auto", lineHeight: 1.6 }}>
          English &amp; Japanese prices, sales history &amp; graded values for One Piece TCG cards
        </p>
      </div>

      {showingSearch ? (
        <>
          <SectionHeader title={`Search Results for "${searchQuery}"`} badge={`${searchResults.length} MATCHES`} />
          {searchingAll ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[...Array(10)].map((_, i) => <Skeleton key={i} h={78} />)}
            </div>
          ) : searchResults.length === 0 ? (
            <div style={{
              background: "#ffffff",
              border: "1px solid #d0dae8",
              borderRadius: 10,
              padding: "22px 18px",
              color: "#64748b",
              fontSize: 13,
              textAlign: "center",
            }}>
              No cards matched that search.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {searchResults.map((card, i) => (
                <TopCardRow key={`${card.region}|${card.card_number}|${card.name}|${i}`} card={card} index={i} showingSearch onSelect={onSelect} />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <SectionHeader title="Most Valuable English Cards" badge="TOP 10 · EN" />
          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[...Array(10)].map((_, i) => <Skeleton key={i} h={78} />)}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {topCards.map((card, i) => (
                <TopCardRow key={`en-${card.card_number}|${card.name}|${i}`} card={card} index={i} onSelect={onSelect} />
              ))}
            </div>
          )}

          <SectionHeader title="Most Valuable Japanese Cards" badge="TOP 10 · JP" />
          {loadingJp ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[...Array(10)].map((_, i) => <Skeleton key={`jp-sk-${i}`} h={78} />)}
            </div>
          ) : topCardsJp.length === 0 ? (
            <div style={{
              background: "#ffffff",
              border: "1px solid #d0dae8",
              borderRadius: 10,
              padding: "22px 18px",
              color: "#64748b",
              fontSize: 13,
              textAlign: "center",
            }}>
              Japanese pricing is unavailable right now. Run the dev server to enable the PriceCharting proxy.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {topCardsJp.map((card, i) => (
                <TopCardRow key={`jp-${card.card_number}|${card.name}|${i}`} card={card} index={i} onSelect={onSelect} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DetailView({ card, detail, loading, onBack, onSelect }) {
  if (!card) return null;
  const cr = R(detail?.rarity ?? card?.rarity);
  const isJapanese = (detail?.region ?? card?.region) === "JP";
  const graded = detail?.graded_prices ?? {};
  const gradedRows = [
    { label: "PSA 9", value: graded.psa9 },
    { label: "PSA 10", value: graded.psa10 },
    { label: "CGC 10", value: graded.cgc10 },
    { label: "CGC 10 Pristine", value: graded.cgc10Pristine },
    { label: "BGS 10 Pristine", value: graded.bgs10Pristine },
    { label: "BGS 10 Black Label", value: graded.bgs10BlackLabel },
  ];
  const hasAnyGraded = gradedRows.some((item) => Number.isFinite(Number(item.value)) && Number(item.value) > 0);
  const gradedConfidencePct = Math.round((Number(detail?.graded_confidence ?? 0) || 0) * 100);

  return (
    <div style={{ animation: "fadeUp .25s ease" }}>
      <button className="hov-back" onClick={onBack}
        style={{ background: "#ffffff", border: "1px solid #d0dae8", color: "#64748b",
          borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontSize: 12,
          marginBottom: 26, display: "inline-flex", alignItems: "center", gap: 6,
          fontFamily: "inherit", transition: "all .15s" }}>
        ← Back to Home
      </button>

      {loading || !detail ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", gap: 24 }}>
            <Skeleton w={180} h={252} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
              <Skeleton h={14} w="40%" />
              <Skeleton h={34} w="70%" />
              <Skeleton h={18} w="35%" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
                {[...Array(4)].map((_, i) => <Skeleton key={i} h={68} />)}
              </div>
            </div>
          </div>
          <Skeleton h={230} />
          <Skeleton h={280} />
        </div>
      ) : (
        <div>
          {/* Top section */}
          <div style={{ display: "flex", gap: 28, marginBottom: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
            <CardArt name={detail.name} rarity={detail.rarity} cardNumber={detail.card_number} imageUrl={detail.image_url} w={178} h={249} />
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ fontSize: 9, letterSpacing: 3.5, color: "#64748b", textTransform: "uppercase", marginBottom: 8 }}>
                {detail.set_name}
              </div>
              <h1 style={{ fontFamily: "'Cinzel',serif", fontSize: 24, fontWeight: 900,
                color: "#1e293b", lineHeight: 1.25, marginBottom: 10 }}>
                {detail.name}
              </h1>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
                <RegionBadge region={detail.region ?? card.region} />
                <span style={{ fontSize: 12, color: "#64748b" }}>{detail.card_number}</span>
                <span style={{ fontSize: 10, padding: "3px 10px", borderRadius: 20,
                  background: `${cr.color}18`, color: cr.color, border: `1px solid ${cr.color}30` }}>
                  {detail.rarity}
                </span>
              </div>
              {detail.description && (
                <p style={{ color: "#475569", fontSize: 13, lineHeight: 1.7, marginBottom: 18, maxWidth: 400 }}>
                  {detail.description}
                </p>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <StatCard label="Current Value" value={`$${Number(detail.current_price ?? 0).toFixed(2)}`} accent={cr.color} big />
                <StatCard label="30d Average"   value={`$${Number(detail.avg_price_30d ?? 0).toFixed(2)}`} accent={cr.color} />
                <StatCard label="30d Low"        value={`$${Number(detail.price_low ?? 0).toFixed(2)}`}     accent={cr.color} />
                <StatCard label="30d High"       value={`$${Number(detail.price_high ?? 0).toFixed(2)}`}    accent={cr.color} />
              </div>
            </div>
          </div>

          <div style={{
            background: "#ffffff",
            border: "1px solid #d0dae8",
            borderRadius: 10,
            padding: "20px 22px",
            marginBottom: 16,
            boxShadow: "0 1px 3px rgba(15,23,42,0.04)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={cr.color} strokeWidth="2.2">
                <path d="M12 2l3 6 6 1-4 4 1 6-6-3-6 3 1-6-4-4 6-1z" />
              </svg>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#475569" }}>Price Breakdown</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
              <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ fontSize: 10, color: "#64748b", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>Raw Market</div>
                <div style={{ fontSize: 17, color: "#1e293b", fontWeight: 700 }}>{formatUsd(detail.raw_market_price ?? detail.current_price)}</div>
              </div>
              <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ fontSize: 10, color: "#64748b", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>Raw Listing</div>
                <div style={{ fontSize: 17, color: "#1e293b", fontWeight: 700 }}>{formatUsd(detail.raw_listing_price ?? detail.inventory_price)}</div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {gradedRows.map((item) => (
                <div key={item.label} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ fontSize: 10, color: "#64748b", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>{item.label}</div>
                  <div style={{ fontSize: 15, color: Number(item.value) > 0 ? cr.color : "#94a3b8", fontWeight: 700 }}>
                    {formatUsd(item.value)}
                  </div>
                </div>
              ))}
            </div>

            {!hasAnyGraded && (
              <div style={{ marginTop: 12, fontSize: 11, color: "#64748b", lineHeight: 1.5 }}>
                {isJapanese
                  ? "Graded prices could not be matched on PriceCharting for this Japanese listing."
                  : "Graded prices are not provided by the current OPTCG API source yet."}
              </div>
            )}
            {detail.graded_source_url && (
              <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <a
                  href={detail.graded_source_url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 11, color: "#2563eb", textDecoration: "none" }}
                >
                  Source: PriceCharting
                </a>
                <span style={{
                  fontSize: 10,
                  borderRadius: 14,
                  padding: "3px 8px",
                  border: `1px solid ${detail.graded_verified ? "#6ee7b7" : "#fdba74"}`,
                  background: detail.graded_verified ? "#ecfdf5" : "#fff7ed",
                  color: detail.graded_verified ? "#047857" : "#c2410c",
                  letterSpacing: 0.4,
                  textTransform: "uppercase",
                }}>
                  {detail.graded_verified ? "Verified Match" : "Unverified Match"}
                </span>
                <span style={{ fontSize: 10, color: "#64748b" }}>
                  Confidence {gradedConfidencePct}%
                </span>
              </div>
            )}
            {detail.graded_source_title && (
              <div style={{ marginTop: 6, fontSize: 10, color: "#64748b" }}>
                Matched listing: {detail.graded_source_title}
              </div>
            )}
          </div>

          {detail.history_unavailable && (
            <div style={{
              marginBottom: 16,
              background: "#fffbeb",
              border: "1px solid #fcd34d",
              borderRadius: 10,
              color: "#92400e",
              fontSize: 12,
              padding: "10px 12px",
              lineHeight: 1.5,
            }}>
              {isJapanese
                ? "Historical price charts are not available for Japanese listings via PriceCharting. Current raw and graded prices are shown above."
                : "Live history is temporarily unavailable from the source API. Current prices and card details are still up to date."}
            </div>
          )}

          {detail.japanese_editions?.length > 0 && (
            <div style={{
              background: "#ffffff",
              border: "1px solid #d0dae8",
              borderRadius: 10,
              padding: "20px 22px",
              marginBottom: 16,
              boxShadow: "0 1px 3px rgba(15,23,42,0.04)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <RegionBadge region="JP" />
                <span style={{ fontSize: 13, fontWeight: 600, color: "#475569" }}>Japanese Editions</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {detail.japanese_editions.map((jpCard, i) => (
                  <TopCardRow
                    key={`jp-ed-${jpCard.card_number}|${jpCard.name}|${i}`}
                    card={jpCard}
                    index={i}
                    showingSearch
                    onSelect={onSelect}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Price chart */}
          {detail.price_history?.length > 0 && (
            <div style={{ background: "#ffffff", border: "1px solid #d0dae8", borderRadius: 10,
              padding: "20px 22px", marginBottom: 16, boxShadow: "0 1px 3px rgba(15,23,42,0.04)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={cr.color} strokeWidth="2.2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#475569" }}>Recent Price History</span>
              </div>
              <ResponsiveContainer width="100%" height={185}>
                <AreaChart data={detail.price_history} margin={{ top: 4, right: 8, bottom: 0, left: 18 }}>
                  <defs>
                    <linearGradient id="agrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={cr.color} stopOpacity={0.22} />
                      <stop offset="95%" stopColor={cr.color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="month" tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false}
                    tickFormatter={v => `$${v}`} width={42} />
                  <Tooltip
                    contentStyle={{ background: "#ffffff", border: `1px solid ${cr.color}55`, borderRadius: 6, fontSize: 12, boxShadow: "0 4px 12px rgba(15,23,42,0.08)" }}
                    labelStyle={{ color: "#64748b" }}
                    formatter={v => [`$${Number(v).toFixed(2)}`, "Price"]}
                    cursor={{ stroke: cr.color, strokeWidth: 1, strokeDasharray: "4 4" }}
                  />
                  <Area type="monotone" dataKey="price" stroke={cr.color} strokeWidth={2} fill="url(#agrad)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Recent sales */}
          {detail.recent_sales?.length > 0 && (
            <div style={{ background: "#ffffff", border: "1px solid #d0dae8", borderRadius: 10, padding: "20px 22px", boxShadow: "0 1px 3px rgba(15,23,42,0.04)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={cr.color} strokeWidth="2.2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#475569" }}>Recent Sales</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {detail.recent_sales.map((s, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "8px 12px", background: "#f8fafc", borderRadius: 6, border: "1px solid #e2e8f0" }}>
                    <span style={{ fontSize: 12, color: "#475569" }}>{s.date}</span>
                    <span style={{ fontSize: 10, color: "#94a3b8", fontFamily: "monospace", letterSpacing: 0.5 }}>{s.source}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: cr.color }}>${Number(s.price).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

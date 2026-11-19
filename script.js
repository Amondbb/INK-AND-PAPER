// ---------- Firebase 초기화 ----------
let db = null;
try {
  firebase.initializeApp(firebaseConfig);
  db = firebase.database();
} catch (e) {
  console.error("Firebase 초기화 실패:", e);
}

const GENRES = ["소설", "에세이", "인문/사회", "경제/경영", "역사", "과학", "자기계발", "시", "만화", "기타"];
const GENRE_COLORS = ["#2F6FEE", "#14B8A6", "#8B5CF6", "#F59E0B", "#EF4444", "#10B981", "#EC4899", "#6366F1", "#D97706", "#64748B"];
let genreFilter = "전체";

function genreColor(genre) {
  const idx = GENRES.indexOf(genre);
  if (idx >= 0) return GENRE_COLORS[idx % GENRE_COLORS.length];
  let hash = 0;
  for (let i = 0; i < genre.length; i++) {
    hash = genre.charCodeAt(i) + ((hash << 5) - hash);
  }
  return GENRE_COLORS[Math.abs(hash) % GENRE_COLORS.length];
}

function chipMarkup(genre, selected) {
  const color = genreColor(genre);
  const style = selected ? `background:${color};border-color:${color};color:#fff;` : `border-color:${color}55;`;
  return `<button type="button" class="genre-chip" data-genre="${escapeHtml(genre)}" style="${style}"><span class="chip-dot" style="background:${color};"></span>${escapeHtml(genre)}</button>`;
}
const CURRENT_YEAR = new Date().getFullYear();
const ALL = "all";

// 기기별 기본값 (이 기기의 브라우저에만 저장)
const PREFS_KEY = "inkpaper_prefs";
const DEFAULT_PREFS = { startView: "year", genre: "", rating: 0 };
function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return { ...DEFAULT_PREFS, ...(raw ? JSON.parse(raw) : {}) };
  } catch (e) {
    return { ...DEFAULT_PREFS };
  }
}
function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (e) {}
}
let prefs = loadPrefs();

let selectedYear = prefs.startView === "all" ? ALL : CURRENT_YEAR; // 숫자(연도) 또는 ALL(전체 보기)
const extraYears = new Set(); // 사용자가 직접 추가한 연도 (책/목표가 아직 없어도 표시)

function yearOf(dateStr) {
  const y = parseInt(String(dateStr || "").slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}

function availableYears() {
  const years = new Set([CURRENT_YEAR, ...extraYears]);
  if (selectedYear !== ALL) years.add(selectedYear);
  Object.values(state.books || {}).forEach((b) => {
    const y = yearOf(b.date);
    if (y) years.add(y);
  });
  Object.keys(state.goals || {}).forEach((k) => {
    if (/^\d{4}$/.test(k)) years.add(Number(k));
  });
  return Array.from(years).sort((a, b) => b - a);
}

function getGoal(year, idx) {
  const g = state.goals && state.goals[year];
  return Number(g && g[idx]) || 0;
}

let state = {
  readers: ["", ""],
  goals: {},
  books: {}, // { id: {reader, date, title, author, rating, genre} }
};
let activeReader = 0;

// ---------- DOM refs ----------
const onboarding = document.getElementById("onboarding");
const mainView = document.getElementById("mainView");
const readerTabsEl = document.getElementById("readerTabs");
const shelfTitle = document.getElementById("shelfTitle");
const bookListEl = document.getElementById("bookList");
const goalYearLabel = document.getElementById("goalYearLabel");
const goalEditRow = document.getElementById("goalEditRow");
const goalDisplay = document.getElementById("goalDisplay");
const goalEmpty = document.getElementById("goalEmpty");
const goalInput = document.getElementById("goalInput");
const goalCountNum = document.getElementById("goalCountNum");
const goalTargetNum = document.getElementById("goalTargetNum");
const goalPct = document.getElementById("goalPct");
const progressFill = document.getElementById("progressFill");
const modalOverlay = document.getElementById("modalOverlay");
const modalTitle = document.getElementById("modalTitle");
const modalBody = document.getElementById("modalBody");
const toastEl = document.getElementById("toast");


function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  setTimeout(() => toastEl.classList.add("hidden"), 2600);
}

// ---------- Firebase sync ----------
if (db) {
  db.ref("readers").on("value", (snap) => {
    const v = snap.val();
    state.readers = v ? [v[0] || "", v[1] || ""] : ["", ""];
    render();
  });
  db.ref("goals").on("value", (snap) => {
    const v = snap.val() || {};
    // 예전 구조(goals/0, goals/1 = 숫자)를 올해 목표(goals/연도/0 ...)로 한 번만 이전
    const updates = {};
    [0, 1].forEach((i) => {
      if (typeof v[i] === "number") {
        updates[`${CURRENT_YEAR}/${i}`] = v[i];
        updates[String(i)] = null;
      }
    });
    if (Object.keys(updates).length) {
      db.ref("goals").update(updates);
      return; // 이전이 끝나면 리스너가 다시 호출돼요
    }
    state.goals = v;
    render();
  });
  db.ref("books").on("value", (snap) => {
    state.books = snap.val() || {};
    render();
  });
} else {
  showToast("Firebase 설정을 확인해 주세요 (firebase-config.js)");
}

function saveReaders(name0, name1) {
  if (!db) return;
  db.ref("readers").set({ 0: name0, 1: name1 });
}

function saveGoal(year, idx, value) {
  if (!db) return;
  db.ref(`goals/${year}/${idx}`).set(Number(value) || 0);
}

function addBook(book) {
  if (!db) return;
  const ref = db.ref("books").push();
  ref.set({ reader: activeReader, ...book });
}

function updateBook(id, book) {
  if (!db) return;
  db.ref("books/" + id).update(book);
}

function deleteBook(id) {
  if (!db) return;
  db.ref("books/" + id).remove();
}

// ---------- Render ----------
function render() {
  const hasReaders = state.readers[0] && state.readers[1];
  onboarding.classList.toggle("hidden", !!hasReaders);
  mainView.classList.toggle("hidden", !hasReaders);
  if (!hasReaders) return;

  renderTabs();
  renderYearTabs();
  renderGoal();
  renderShelf();
}

function renderTabs() {
  readerTabsEl.innerHTML = "";
  state.readers.forEach((name, idx) => {
    const btn = document.createElement("button");
    btn.className = "tab-btn" + (activeReader === idx ? " active" : "");
    btn.textContent = name || `리더 ${idx + 1}`;
    btn.onclick = () => {
      activeReader = idx;
      genreFilter = "전체";
      render();
    };
    readerTabsEl.appendChild(btn);
  });
}

function renderYearTabs() {
  const el = document.getElementById("yearTabs");
  const years = availableYears();
  el.innerHTML =
    `<button type="button" class="year-chip${selectedYear === ALL ? " active" : ""}" data-year="${ALL}">전체</button>` +
    years
      .map(
        (y) =>
          `<button type="button" class="year-chip${y === selectedYear ? " active" : ""}" data-year="${y}">${y}</button>`
      )
      .join("") +
    `<button type="button" class="year-chip year-add" id="yearAddBtn" aria-label="연도 추가">+ 연도 추가</button>` +
    (selectedYear !== ALL
      ? `<button type="button" class="year-chip year-manage" id="yearManageBtn" aria-label="${selectedYear}년 관리">연도 관리</button>`
      : "");

  el.querySelectorAll(".year-chip[data-year]").forEach((chip) => {
    chip.onclick = () => {
      selectedYear = chip.dataset.year === ALL ? ALL : Number(chip.dataset.year);
      genreFilter = "전체";
      render();
    };
  });
  document.getElementById("yearAddBtn").onclick = openYearModal;
  const manageBtn = document.getElementById("yearManageBtn");
  if (manageBtn) manageBtn.onclick = () => openYearManageModal(selectedYear);
}

function booksForReader(idx) {
  return Object.entries(state.books || {})
    .filter(([, b]) => b.reader === idx)
    .map(([id, b]) => ({ id, ...b }));
}

function booksForReaderYear(idx, year) {
  return year === ALL ? booksForReader(idx) : booksForReader(idx).filter((b) => yearOf(b.date) === year);
}

function renderGoal() {
  const goalCard = document.querySelector(".goal-card");
  goalCard.classList.toggle("hidden", selectedYear === ALL);
  if (selectedYear === ALL) return;
  goalYearLabel.textContent = selectedYear + "년 목표";
  goalEditRow.classList.add("hidden");
  const goal = getGoal(selectedYear, activeReader);
  const count = booksForReaderYear(activeReader, selectedYear).length;

  goalInput.value = goal || "";

  if (goal > 0) {
    goalDisplay.classList.remove("hidden");
    goalEmpty.classList.add("hidden");
    const pct = Math.min(100, Math.round((count / goal) * 100));
    goalCountNum.textContent = count;
    goalTargetNum.textContent = goal;
    goalPct.textContent = pct;
    progressFill.style.width = pct + "%";
  } else {
    goalDisplay.classList.add("hidden");
    goalEmpty.classList.remove("hidden");
  }
}

function renderShelf() {
  const name = state.readers[activeReader] || `리더 ${activeReader + 1}`;
  shelfTitle.textContent = selectedYear === ALL ? `${name}의 전체 책장` : `${name}의 ${selectedYear}년 책장`;

  const allBooks = booksForReaderYear(activeReader, selectedYear);
  renderGenreStats(allBooks);
  renderGenreFilter(allBooks);

  const filtered = (genreFilter === "전체" ? allBooks : allBooks.filter((b) => b.genre === genreFilter)).sort(
    (a, b) => new Date(b.date) - new Date(a.date)
  );

  bookListEl.innerHTML = "";

  if (filtered.length === 0) {
    bookListEl.innerHTML = `
      <div class="card empty-state">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none"><path d="M4 4.5C4 3.67 4.67 3 5.5 3H11V21H5.5C4.67 21 4 20.33 4 19.5V4.5Z" stroke="currentColor" stroke-width="1.6"/><path d="M20 4.5C20 3.67 19.33 3 18.5 3H13V21H18.5C19.33 21 20 20.33 20 19.5V4.5Z" stroke="currentColor" stroke-width="1.6"/></svg>
        <div>${allBooks.length === 0 ? (selectedYear === ALL ? "아직 기록된 책이 없어요. 첫 책을 기록해보세요." : `${selectedYear}년에 기록된 책이 없어요. 첫 책을 기록해보세요.`) : "이 장르에 기록된 책이 없어요."}</div>
      </div>`;
    return;
  }

  filtered.forEach((b) => {
    const card = document.createElement("div");
    card.className = "book-card";
    card.innerHTML = `
      <div class="book-main">
        <div class="book-title-row">
          <span class="book-title">${escapeHtml(b.title)}</span>
          <span class="genre-badge" style="background:${genreColor(b.genre)};">${escapeHtml(b.genre)}</span>
        </div>
        <div class="book-sub">${escapeHtml(b.author)} · ${b.date}</div>
        <div class="stars">${starSvgRow(b.rating)}</div>
      </div>
      <div class="book-actions">
        <button class="edit-btn" aria-label="수정">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
        </button>
        <button class="delete-btn" aria-label="삭제">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m2 0-1 13a1 1 0 01-1 1H8a1 1 0 01-1-1L6 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>`;
    card.querySelector(".delete-btn").onclick = () => deleteBook(b.id);
    card.querySelector(".edit-btn").onclick = () => openBookModal(b);
    bookListEl.appendChild(card);
  });
}

function renderGenreFilter(allBooks) {
  const filterRow = document.getElementById("genreFilterRow");
  const presentGenres = Array.from(new Set(allBooks.map((b) => b.genre)));

  if (presentGenres.length === 0) {
    filterRow.innerHTML = "";
    return;
  }

  const options = ["전체", ...presentGenres];
  filterRow.innerHTML = options
    .map((g) => {
      const isAll = g === "전체";
      const color = isAll ? "var(--navy)" : genreColor(g);
      const selected = genreFilter === g;
      const style = selected ? `background:${color};border-color:${color};color:#fff;` : `border-color:${color}55;`;
      const dot = isAll ? "" : `<span class="chip-dot" style="background:${color};"></span>`;
      return `<button type="button" class="genre-chip filter-chip" data-genre="${escapeHtml(g)}" style="${style}">${dot}${escapeHtml(g)}</button>`;
    })
    .join("");

  filterRow.querySelectorAll(".filter-chip").forEach((chip) => {
    chip.onclick = () => {
      genreFilter = chip.dataset.genre;
      renderShelf();
    };
  });
}

function renderGenreStats(allBooks) {
  const bar = document.getElementById("genreStatsBar");
  const legend = document.getElementById("genreStatsLegend");
  const card = bar.closest(".genre-stats-card");

  if (allBooks.length === 0) {
    card.classList.add("hidden");
    return;
  }
  card.classList.remove("hidden");

  const counts = {};
  allBooks.forEach((b) => {
    counts[b.genre] = (counts[b.genre] || 0) + 1;
  });
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const total = allBooks.length;

  bar.innerHTML = entries
    .map(([genre, count]) => {
      const pct = (count / total) * 100;
      const color = genreColor(genre);
      return `<div class="seg" style="width:${pct}%;background:${color};" title="${escapeHtml(genre)} ${count}권"></div>`;
    })
    .join("");

  legend.innerHTML = entries
    .map(([genre, count]) => {
      const pct = Math.round((count / total) * 100);
      const color = genreColor(genre);
      return `<div class="legend-item"><span class="legend-dot" style="background:${color};"></span>${escapeHtml(genre)} <b>${count}권</b> (${pct}%)</div>`;
    })
    .join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function starSvgRow(rating, size = 15, interactiveId = null) {
  let html = "";
  for (let n = 1; n <= 5; n++) {
    const filled = n <= rating;
    if (interactiveId) {
      html += `<button type="button" class="star-btn" data-n="${n}" data-target="${interactiveId}">${starSvg(size, filled)}</button>`;
    } else {
      html += starSvg(size, filled);
    }
  }
  return html;
}

function starSvg(size, filled) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${filled ? "#2F6FEE" : "none"}" stroke="${filled ? "#2F6FEE" : "#8592AC"}" stroke-width="1.4"><path d="M12 2.5l2.9 6.1 6.6.9-4.8 4.7 1.2 6.6L12 17.8l-5.9 3 1.2-6.6L2.5 9.5l6.6-.9L12 2.5z" stroke-linejoin="round"/></svg>`;
}

// ---------- Onboarding ----------
document.getElementById("onbStart").onclick = () => {
  const n0 = document.getElementById("onbName0").value.trim();
  const n1 = document.getElementById("onbName1").value.trim();
  if (!n0 || !n1) {
    showToast("두 사람의 이름을 모두 입력해 주세요");
    return;
  }
  saveReaders(n0, n1);
};

// ---------- Goal edit ----------
document.getElementById("goalEditBtn").onclick = () => {
  goalEditRow.classList.toggle("hidden");
};
document.getElementById("goalSaveBtn").onclick = () => {
  saveGoal(selectedYear, activeReader, goalInput.value);
  goalEditRow.classList.add("hidden");
  showToast(`${selectedYear}년 목표를 저장했어요`);
};

// ---------- Add / edit book modal ----------
document.getElementById("addBookBtn").onclick = () => openBookModal();

function defaultDateForYear(year) {
  if (year === ALL || year === CURRENT_YEAR) {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  return `${year}-12-31`;
}

function openBookModal(existing = null) {
  const isEdit = !!existing;
  modalTitle.textContent = isEdit ? "책 정보 수정" : "책 기록하기";
  let selectedRating = isEdit ? existing.rating : Number(prefs.rating) || 0;
  let selectedGenre = isEdit
    ? (GENRES.includes(existing.genre) ? existing.genre : GENRES[0])
    : (GENRES.includes(prefs.genre) ? prefs.genre : GENRES[0]);
  let initialCustomGenre = isEdit && !GENRES.includes(existing.genre) ? existing.genre : "";

  modalBody.innerHTML = `
    <div class="field">
      <label>책 제목</label>
      <input type="text" id="f_title" placeholder="예: 데미안" />
    </div>
    <div class="field">
      <label>저자</label>
      <input type="text" id="f_author" placeholder="예: 헤르만 헤세" />
    </div>
    <div class="field">
      <label>완독일자</label>
      <input type="date" id="f_date" />
    </div>
    <div class="field">
      <label>평점</label>
      <div class="stars" id="f_stars">${starSvgRow(selectedRating, 24, "f_stars")}</div>
    </div>
    <div class="field">
      <label>장르</label>
      <div class="genre-chip-row" id="f_genreRow">
        ${GENRES.map((g) => chipMarkup(g, g === selectedGenre && !initialCustomGenre)).join("")}
      </div>
      <input type="text" id="f_customGenre" placeholder="직접 입력 (선택)" />
    </div>
    <button id="f_save" class="btn-primary btn-block">${isEdit ? "수정 완료" : "저장하기"}</button>
  `;

  document.getElementById("f_title").value = isEdit ? existing.title : "";
  document.getElementById("f_author").value = isEdit ? existing.author : "";
  document.getElementById("f_date").value = isEdit ? existing.date : defaultDateForYear(selectedYear);
  document.getElementById("f_customGenre").value = initialCustomGenre;

  function attachStarHandlers() {
    modalBody.querySelectorAll(".star-btn").forEach((btn) => {
      btn.onclick = () => {
        selectedRating = Number(btn.dataset.n);
        document.getElementById("f_stars").innerHTML = starSvgRow(selectedRating, 24, "f_stars");
        attachStarHandlers();
      };
    });
  }
  attachStarHandlers();

  modalBody.querySelectorAll(".genre-chip").forEach((chip) => {
    chip.onclick = () => {
      selectedGenre = chip.dataset.genre;
      document.getElementById("f_customGenre").value = "";
      modalBody.querySelectorAll(".genre-chip").forEach((c) => {
        const color = genreColor(c.dataset.genre);
        c.style.cssText = `border-color:${color}55;`;
        c.classList.remove("selected");
      });
      const color = genreColor(chip.dataset.genre);
      chip.style.cssText = `background:${color};border-color:${color};color:#fff;`;
    };
  });

  document.getElementById("f_save").onclick = () => {
    const title = document.getElementById("f_title").value.trim();
    const author = document.getElementById("f_author").value.trim();
    const date = document.getElementById("f_date").value;
    const customGenre = document.getElementById("f_customGenre").value.trim();

    if (!title || !author || !date) {
      showToast("제목, 저자, 완독일자를 입력해 주세요");
      return;
    }

    const payload = {
      title,
      author,
      date,
      rating: selectedRating,
      genre: customGenre || selectedGenre,
    };

    const savedYear = yearOf(date);
    if (savedYear && selectedYear !== ALL) selectedYear = savedYear;

    if (isEdit) {
      updateBook(existing.id, payload);
      showToast("기록을 수정했어요");
    } else {
      addBook(payload);
      showToast("책을 기록했어요");
    }
    closeModal();
  };

  openModal();
}

// ---------- Year add modal ----------
function openYearModal() {
  modalTitle.textContent = "연도 추가";
  modalBody.innerHTML = `
    <div class="field">
      <label>추가할 연도</label>
      <input type="number" id="y_input" min="1900" max="2100" placeholder="예: 2025" />
    </div>
    <button id="y_save" class="btn-primary btn-block">추가하기</button>
  `;
  document.getElementById("y_save").onclick = () => {
    const y = parseInt(document.getElementById("y_input").value, 10);
    if (!y || y < 1900 || y > 2100) {
      showToast("올바른 연도를 입력해 주세요");
      return;
    }
    extraYears.add(y);
    selectedYear = y;
    genreFilter = "전체";
    closeModal();
    render();
  };
  openModal();
}

// ---------- Year manage (rename / delete) ----------
function readerName(i) {
  return state.readers[i] || `리더 ${i + 1}`;
}

function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

// 날짜의 연도만 바꾸고, 윤년이 아닌 해로 가면 2/29는 2/28로 맞춰요
function shiftDate(dateStr, newYear) {
  const rest = String(dateStr).slice(4);
  if (rest === "-02-29" && !isLeapYear(newYear)) return `${newYear}-02-28`;
  return `${newYear}${rest}`;
}

function openYearManageModal(year) {
  const me = activeReader;
  const myBooks = Object.entries(state.books || {}).filter(
    ([, b]) => b.reader === me && yearOf(b.date) === year
  );

  modalTitle.textContent = `${year}년 관리`;
  modalBody.innerHTML = `
    <p class="muted small" style="margin:0 0 4px;">
      <b style="color:var(--navy);">${escapeHtml(readerName(me))}</b>의 ${year}년 기록만 바뀌어요. 상대방의 기록은 그대로예요.
    </p>
    <div class="field">
      <label>연도 변경</label>
      <input type="number" id="ym_input" min="1900" max="2100" value="${year}" />
      <p class="muted small" style="margin:8px 0 0;">책 ${myBooks.length}권의 완독일자와 연간 목표가 새 연도로 옮겨져요.</p>
    </div>
    <button id="ym_save" class="btn-primary btn-block">변경하기</button>
    <div class="manage-divider"></div>
    <button id="ym_delete" class="quiet-danger">${year}년 내 기록 삭제…</button>
  `;

  document.getElementById("ym_save").onclick = () => {
    const newYear = parseInt(document.getElementById("ym_input").value, 10);
    if (!newYear || newYear < 1900 || newYear > 2100) {
      showToast("올바른 연도를 입력해 주세요");
      return;
    }
    if (newYear === year) {
      closeModal();
      return;
    }
    renameYear(year, newYear);
    closeModal();
  };
  document.getElementById("ym_delete").onclick = () => openYearDeleteModal(year);
  openModal();
}

function renameYear(oldYear, newYear) {
  const me = activeReader;
  const updates = {};

  Object.entries(state.books || {}).forEach(([id, b]) => {
    if (b.reader === me && yearOf(b.date) === oldYear) {
      updates[`books/${id}/date`] = shiftDate(b.date, newYear);
    }
  });

  let goalKept = false;
  const oldGoal = getGoal(oldYear, me);
  if (oldGoal > 0) {
    if (getGoal(newYear, me) > 0) {
      goalKept = true; // 새 연도에 이미 목표가 있으면 그 목표를 유지해요
    } else {
      updates[`goals/${newYear}/${me}`] = oldGoal;
    }
    updates[`goals/${oldYear}/${me}`] = null;
  }

  if (db && Object.keys(updates).length) db.ref().update(updates);

  extraYears.delete(oldYear);
  extraYears.add(newYear);
  selectedYear = newYear;
  genreFilter = "전체";
  showToast(goalKept ? `${newYear}년으로 옮겼어요 (기존 ${newYear}년 목표는 유지)` : `${newYear}년으로 변경했어요`);
  render();
}

function openYearDeleteModal(year) {
  const me = activeReader;
  const bookIds = Object.entries(state.books || {})
    .filter(([, b]) => b.reader === me && yearOf(b.date) === year)
    .map(([id]) => id);
  const hasGoal = getGoal(year, me) > 0;

  modalTitle.textContent = `${year}년 내 기록 삭제`;
  modalBody.innerHTML = `
    <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:var(--ink-soft);">
      <b style="color:var(--navy);">${escapeHtml(readerName(me))}</b>의 ${year}년 데이터만 삭제돼요. 상대방의 기록은 그대로 남아요. 삭제하면 되돌릴 수 없어요.
    </p>
    <ul style="margin:0 0 18px;padding-left:18px;font-size:14px;line-height:1.8;color:var(--ink);">
      <li>기록된 책: ${bookIds.length}권</li>
      <li>연간 목표: ${hasGoal ? "있음" : "없음"}</li>
    </ul>
    <button id="yd_confirm" class="quiet-danger solid">삭제하기</button>
    <button id="yd_cancel" class="link-btn" style="display:block;margin:12px auto 0;">취소</button>
  `;
  document.getElementById("yd_cancel").onclick = closeModal;
  document.getElementById("yd_confirm").onclick = () => {
    deleteYear(year, bookIds);
    closeModal();
  };
  openModal();
}

function deleteYear(year, bookIds) {
  const me = activeReader;
  const other = 1 - me;

  if (db) {
    const updates = {};
    bookIds.forEach((id) => (updates["books/" + id] = null));
    updates[`goals/${year}/${me}`] = null;
    db.ref().update(updates);
  }

  extraYears.delete(year);
  const otherHasData =
    booksForReaderYear(other, year).length > 0 || getGoal(year, other) > 0;
  if (selectedYear === year && year !== CURRENT_YEAR && !otherHasData) {
    selectedYear = ALL;
  }
  genreFilter = "전체";
  showToast(`${year}년 내 기록을 삭제했어요`);
  render();
}

// ---------- Settings modal ----------
document.getElementById("settingsBtn").onclick = () => {
  renderSettings();
  openModal();
};

function renderSettings() {
  const me = activeReader;
  const scroller = modalBody.closest(".modal");
  const keepTop = scroller ? scroller.scrollTop : 0;
  modalTitle.textContent = "설정";

  const genreCounts = {};
  booksForReader(me).forEach((b) => {
    genreCounts[b.genre] = (genreCounts[b.genre] || 0) + 1;
  });
  const genreEntries = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]);
  const defGenre = GENRES.includes(prefs.genre) ? prefs.genre : GENRES[0];

  const genreRows = genreEntries.length
    ? genreEntries
        .map(
          ([g, n]) => `
      <div class="gm-row" data-genre="${escapeHtml(g)}">
        <span class="gm-name"><span class="chip-dot" style="background:${genreColor(g)};"></span>${escapeHtml(g)}</span>
        <span class="gm-count">${n}권</span>
        <button type="button" class="edit-btn gm-edit" aria-label="이름 바꾸기">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
        </button>
      </div>`
        )
        .join("")
    : `<p class="muted small" style="margin:0;">아직 기록된 장르가 없어요.</p>`;

  modalBody.innerHTML = `
    <div class="set-section">
      <h3 class="set-title">이름</h3>
      <div class="field">
        <label>첫 번째 사람 이름</label>
        <input type="text" id="s_name0" value="${escapeHtml(state.readers[0])}" />
      </div>
      <div class="field">
        <label>두 번째 사람 이름</label>
        <input type="text" id="s_name1" value="${escapeHtml(state.readers[1])}" />
      </div>
      <button id="s_save" class="btn-primary btn-sm">이름 저장</button>
    </div>

    <div class="set-section">
      <h3 class="set-title">기본값 <span class="set-hint">이 기기에만 저장돼요</span></h3>
      <div class="field">
        <label>앱을 열 때 처음 보여줄 화면</label>
        <div class="tabs" id="p_start" style="margin-bottom:0;">
          <button type="button" class="tab-btn${prefs.startView !== "all" ? " active" : ""}" data-v="year">올해</button>
          <button type="button" class="tab-btn${prefs.startView === "all" ? " active" : ""}" data-v="all">전체</button>
        </div>
      </div>
      <div class="field">
        <label>책 기록 시 기본 장르</label>
        <div class="genre-chip-row" id="p_genre">
          ${GENRES.map((g) => chipMarkup(g, g === defGenre)).join("")}
        </div>
      </div>
      <div class="field">
        <label>책 기록 시 기본 별점 <span class="set-hint">같은 별을 다시 누르면 해제돼요</span></label>
        <div class="stars" id="p_stars">${starSvgRow(Number(prefs.rating) || 0, 24, "p_stars")}</div>
      </div>
    </div>

    <div class="set-section">
      <h3 class="set-title">장르 관리 <span class="set-hint">${escapeHtml(readerName(me))}의 기록 기준</span></h3>
      <p class="muted small" style="margin:0 0 8px;">이름을 바꾸면 해당 장르의 책이 모두 바뀌어요. 이미 있는 장르 이름으로 바꾸면 하나로 합쳐져요.</p>
      <div id="gm_list">${genreRows}</div>
    </div>

    <div class="set-section">
      <h3 class="set-title">데이터 백업</h3>
      <div class="backup-actions">
        <button type="button" class="btn-outline" id="b_json">백업 파일 내려받기 (JSON · 전체)</button>
        <button type="button" class="btn-outline" id="b_csv">엑셀용 내려받기 (CSV · 전체)</button>
        <button type="button" class="btn-outline" id="b_import">백업 파일에서 가져오기</button>
        <input type="file" id="b_file" accept=".json,application/json" hidden />
      </div>
      <p class="muted small" style="margin:10px 0 0;">가져오기는 백업에 있는 책 중 지금 없는 책만 추가하고, 기존 기록은 바꾸거나 지우지 않아요.</p>
    </div>
  `;

  // 이름 저장
  document.getElementById("s_save").onclick = () => {
    const n0 = document.getElementById("s_name0").value.trim();
    const n1 = document.getElementById("s_name1").value.trim();
    if (!n0 || !n1) {
      showToast("두 사람의 이름을 모두 입력해 주세요");
      return;
    }
    saveReaders(n0, n1);
    showToast("이름을 저장했어요");
  };

  // 기본값: 시작 화면
  modalBody.querySelectorAll("#p_start .tab-btn").forEach((btn) => {
    btn.onclick = () => {
      prefs.startView = btn.dataset.v;
      savePrefs();
      modalBody.querySelectorAll("#p_start .tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
      showToast("기본값을 저장했어요");
    };
  });

  // 기본값: 장르
  modalBody.querySelectorAll("#p_genre .genre-chip").forEach((chip) => {
    chip.onclick = () => {
      prefs.genre = chip.dataset.genre;
      savePrefs();
      modalBody.querySelectorAll("#p_genre .genre-chip").forEach((c) => {
        c.style.cssText = `border-color:${genreColor(c.dataset.genre)}55;`;
      });
      const color = genreColor(chip.dataset.genre);
      chip.style.cssText = `background:${color};border-color:${color};color:#fff;`;
      showToast("기본값을 저장했어요");
    };
  });

  // 기본값: 별점
  function attachPrefStars() {
    modalBody.querySelectorAll("#p_stars .star-btn").forEach((btn) => {
      btn.onclick = () => {
        const n = Number(btn.dataset.n);
        prefs.rating = prefs.rating === n ? 0 : n;
        savePrefs();
        document.getElementById("p_stars").innerHTML = starSvgRow(prefs.rating, 24, "p_stars");
        attachPrefStars();
        showToast("기본값을 저장했어요");
      };
    });
  }
  attachPrefStars();

  // 장르 관리
  modalBody.querySelectorAll(".gm-row").forEach((row) => {
    const oldGenre = row.dataset.genre;
    row.querySelector(".gm-edit").onclick = () => {
      row.innerHTML = `
        <input type="text" class="gm-input" maxlength="20" value="${escapeHtml(oldGenre)}" />
        <button type="button" class="btn-primary btn-sm gm-ok">저장</button>
        <button type="button" class="link-btn gm-cancel">취소</button>`;
      const input = row.querySelector(".gm-input");
      input.focus();
      input.select();
      row.querySelector(".gm-cancel").onclick = renderSettings;
      const commit = () => {
        const newGenre = input.value.trim();
        if (!newGenre) {
          showToast("장르 이름을 입력해 주세요");
          return;
        }
        if (newGenre === oldGenre) {
          renderSettings();
          return;
        }
        renameGenre(oldGenre, newGenre);
      };
      row.querySelector(".gm-ok").onclick = commit;
      input.onkeydown = (e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") renderSettings();
      };
    };
  });

  // 백업
  document.getElementById("b_json").onclick = exportJson;
  document.getElementById("b_csv").onclick = exportCsv;
  const fileInput = document.getElementById("b_file");
  document.getElementById("b_import").onclick = () => fileInput.click();
  fileInput.onchange = () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = "";
    if (file) handleImportFile(file);
  };

  if (scroller) scroller.scrollTop = keepTop;
}

// ---------- 장르 이름 바꾸기 / 합치기 ----------
function renameGenre(oldGenre, newGenre) {
  const me = activeReader;
  const merged = booksForReader(me).some((b) => b.genre === newGenre);
  const updates = {};
  booksForReader(me).forEach((b) => {
    if (b.genre === oldGenre) updates[`books/${b.id}/genre`] = newGenre;
  });
  if (db && Object.keys(updates).length) db.ref().update(updates);
  if (genreFilter === oldGenre) genreFilter = "전체";
  showToast(merged ? `"${newGenre}"(으)로 합쳤어요` : "장르 이름을 바꿨어요");
  setTimeout(renderSettings, 60);
}

// ---------- 백업: 내려받기 ----------
function pad2(n) {
  return String(n).padStart(2, "0");
}
function dateStamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}

function downloadFile(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function exportJson() {
  const goals = {};
  Object.keys(state.goals || {}).forEach((k) => {
    if (/^\d{4}$/.test(k)) goals[k] = { 0: getGoal(k, 0), 1: getGoal(k, 1) };
  });
  const payload = {
    app: "ink-and-paper",
    version: 1,
    exportedAt: new Date().toISOString(),
    readers: state.readers,
    goals,
    books: state.books || {},
  };
  downloadFile(`ink-and-paper-backup-${dateStamp()}.json`, JSON.stringify(payload, null, 2), "application/json");
  showToast("백업 파일을 내려받았어요");
}

function csvCell(v) {
  let t = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; // 엑셀 수식으로 해석되는 것 방지
  return `"${t.replace(/"/g, '""')}"`;
}

function exportCsv() {
  const rows = Object.values(state.books || {})
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const header = ["독서자", "제목", "저자", "완독일자", "평점", "장르"];
  const lines = [header.map(csvCell).join(",")];
  rows.forEach((b) => {
    lines.push(
      [readerName(b.reader), b.title, b.author, b.date, b.rating ?? 0, b.genre].map(csvCell).join(",")
    );
  });
  downloadFile(`ink-and-paper-${dateStamp()}.csv`, "\uFEFF" + lines.join("\r\n"), "text/csv;charset=utf-8");
  showToast("CSV 파일을 내려받았어요");
}

// ---------- 백업: 가져오기 ----------
function bookKey(b) {
  return [b.reader, b.title, b.author, b.date].join("|");
}

function sanitizeBook(b) {
  if (!b || typeof b !== "object") return null;
  const title = String(b.title ?? "").trim().slice(0, 200);
  const author = String(b.author ?? "").trim().slice(0, 200);
  const date = String(b.date ?? "");
  const reader = Number(b.reader);
  if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date) || (reader !== 0 && reader !== 1)) return null;
  const rating = Math.max(0, Math.min(5, Math.round(Number(b.rating) || 0)));
  const genre = String(b.genre ?? "").trim().slice(0, 30) || "기타";
  return { reader, title, author, date, rating, genre };
}

function planImport(data) {
  if (!data || typeof data !== "object" || !data.books || typeof data.books !== "object") {
    throw new Error("invalid backup");
  }
  const existingIds = new Set(Object.keys(state.books || {}));
  const existingKeys = new Set(Object.values(state.books || {}).map(bookKey));

  const books = {};
  let dup = 0;
  let invalid = 0;
  Object.entries(data.books).forEach(([id, raw]) => {
    const clean = sanitizeBook(raw);
    if (!clean) {
      invalid++;
      return;
    }
    if (existingIds.has(id) || existingKeys.has(bookKey(clean))) {
      dup++;
      return;
    }
    const key = /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : db.ref("books").push().key;
    books[key] = clean;
    existingKeys.add(bookKey(clean));
  });

  const goals = {};
  const goalSrc = data.goals && typeof data.goals === "object" ? data.goals : {};
  Object.keys(goalSrc).forEach((k) => {
    const y = Number(k);
    if (!/^\d{4}$/.test(k) || y < 1900 || y > 2100 || !goalSrc[k] || typeof goalSrc[k] !== "object") return;
    [0, 1].forEach((i) => {
      const v = Math.round(Number(goalSrc[k][i]));
      if (v > 0 && getGoal(y, i) === 0) goals[`${y}/${i}`] = v;
    });
  });

  return { books, goals, dup, invalid };
}

function handleImportFile(file) {
  if (!db) {
    showToast("Firebase 연결을 확인해 주세요");
    return;
  }
  const reader = new FileReader();
  reader.onerror = () => showToast("파일을 읽지 못했어요");
  reader.onload = () => {
    let plan;
    try {
      plan = planImport(JSON.parse(reader.result));
    } catch (e) {
      showToast("올바른 백업 파일이 아니에요");
      return;
    }
    openImportConfirm(plan);
  };
  reader.readAsText(file, "utf-8");
}

function openImportConfirm(plan) {
  const nBooks = Object.keys(plan.books).length;
  const nGoals = Object.keys(plan.goals).length;
  const nothing = nBooks === 0 && nGoals === 0;

  modalTitle.textContent = "백업 가져오기";
  modalBody.innerHTML = `
    <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:var(--ink-soft);">
      ${nothing ? "새로 추가할 내용이 없어요." : "아래 내용이 추가돼요. 기존 기록은 바꾸거나 지우지 않아요."}
    </p>
    <ul style="margin:0 0 18px;padding-left:18px;font-size:14px;line-height:1.8;color:var(--ink);">
      <li>새로 추가될 책: <b>${nBooks}권</b></li>
      <li>비어 있어서 채워질 연간 목표: <b>${nGoals}개</b></li>
      <li class="muted">이미 있어서 건너뛸 책: ${plan.dup}권</li>
      ${plan.invalid ? `<li class="muted">형식이 맞지 않아 건너뛸 항목: ${plan.invalid}개</li>` : ""}
    </ul>
    <button id="i_confirm" class="btn-primary btn-block" style="margin-top:0;" ${nothing ? "disabled" : ""}>가져오기</button>
    <button id="i_cancel" class="link-btn" style="display:block;margin:12px auto 0;">돌아가기</button>
  `;
  document.getElementById("i_cancel").onclick = renderSettings;
  document.getElementById("i_confirm").onclick = () => {
    const updates = {};
    Object.entries(plan.books).forEach(([id, b]) => (updates["books/" + id] = b));
    Object.entries(plan.goals).forEach(([path, v]) => (updates["goals/" + path] = v));
    db.ref().update(updates);
    closeModal();
    showToast(`책 ${nBooks}권을 가져왔어요`);
  };
}

function openModal() {
  modalOverlay.classList.remove("hidden");
}
function closeModal() {
  modalOverlay.classList.add("hidden");
}
document.getElementById("modalClose").onclick = closeModal;
modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) closeModal();
});

render();

// ---------- Firebase 초기화 ----------
let db = null;
try {
  firebase.initializeApp(firebaseConfig);
  db = firebase.database();
} catch (e) {
  console.error("Firebase 초기화 실패:", e);
}

const GENRES = ["소설", "에세이", "인문/사회", "경제/경영", "역사", "과학", "자기계발", "시", "만화", "기타"];
const GENRE_COLORS = ["#2F6FEE", "#5B8DEF", "#8DAEF5", "#13294B", "#4C5A75", "#7FA8F0", "#A6C2F7", "#1D3E6E", "#3C6BC4", "#8592AC"];
let genreFilter = "전체";
const YEAR = new Date().getFullYear();

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

goalYearLabel.textContent = YEAR + "년 목표";

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
    state.goals = snap.val() || {};
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

function saveGoal(idx, value) {
  if (!db) return;
  db.ref("goals/" + idx).set(Number(value) || 0);
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

function booksForReader(idx) {
  return Object.entries(state.books || {})
    .filter(([, b]) => b.reader === idx)
    .map(([id, b]) => ({ id, ...b }));
}

function renderGoal() {
  const goal = Number(state.goals[activeReader] || 0);
  const count = booksForReader(activeReader).filter(
    (b) => new Date(b.date).getFullYear() === YEAR
  ).length;

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
  shelfTitle.textContent = `${name}의 책장`;

  const allBooks = booksForReader(activeReader);
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
        <div>${allBooks.length === 0 ? "아직 기록된 책이 없어요. 첫 책을 기록해보세요." : "이 장르에 기록된 책이 없어요."}</div>
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
          <span class="genre-badge">${escapeHtml(b.genre)}</span>
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
    .map(
      (g) =>
        `<button type="button" class="genre-chip filter-chip${genreFilter === g ? " selected" : ""}" data-genre="${escapeHtml(g)}">${escapeHtml(g)}</button>`
    )
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
    .map(([genre, count], i) => {
      const pct = (count / total) * 100;
      const color = GENRE_COLORS[i % GENRE_COLORS.length];
      return `<div class="seg" style="width:${pct}%;background:${color};" title="${escapeHtml(genre)} ${count}권"></div>`;
    })
    .join("");

  legend.innerHTML = entries
    .map(([genre, count], i) => {
      const pct = Math.round((count / total) * 100);
      const color = GENRE_COLORS[i % GENRE_COLORS.length];
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
  saveGoal(activeReader, goalInput.value);
  goalEditRow.classList.add("hidden");
  showToast("목표를 저장했어요");
};

// ---------- Add / edit book modal ----------
document.getElementById("addBookBtn").onclick = () => openBookModal();

function openBookModal(existing = null) {
  const isEdit = !!existing;
  modalTitle.textContent = isEdit ? "책 정보 수정" : "책 기록하기";
  let selectedRating = isEdit ? existing.rating : 0;
  let selectedGenre = isEdit && GENRES.includes(existing.genre) ? existing.genre : GENRES[0];
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
        ${GENRES.map((g) => `<button type="button" class="genre-chip${g === selectedGenre && !initialCustomGenre ? " selected" : ""}" data-genre="${g}">${g}</button>`).join("")}
      </div>
      <input type="text" id="f_customGenre" placeholder="직접 입력 (선택)" />
    </div>
    <button id="f_save" class="btn-primary btn-block">${isEdit ? "수정 완료" : "저장하기"}</button>
  `;

  document.getElementById("f_title").value = isEdit ? existing.title : "";
  document.getElementById("f_author").value = isEdit ? existing.author : "";
  document.getElementById("f_date").value = isEdit ? existing.date : new Date().toISOString().slice(0, 10);
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
      modalBody.querySelectorAll(".genre-chip").forEach((c) => c.classList.remove("selected"));
      chip.classList.add("selected");
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

// ---------- Settings modal ----------
document.getElementById("settingsBtn").onclick = () => {
  modalTitle.textContent = "설정";
  modalBody.innerHTML = `
    <div class="field">
      <label>첫 번째 사람 이름</label>
      <input type="text" id="s_name0" value="${escapeHtml(state.readers[0])}" />
    </div>
    <div class="field">
      <label>두 번째 사람 이름</label>
      <input type="text" id="s_name1" value="${escapeHtml(state.readers[1])}" />
    </div>
    <button id="s_save" class="btn-primary btn-block">저장하기</button>
  `;
  document.getElementById("s_save").onclick = () => {
    const n0 = document.getElementById("s_name0").value.trim();
    const n1 = document.getElementById("s_name1").value.trim();
    if (n0 && n1) {
      saveReaders(n0, n1);
      closeModal();
      showToast("설정을 저장했어요");
    }
  };
  openModal();
};

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

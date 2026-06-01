const express = require("express");
const axios = require("axios");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = "https://occac-akem-leviwhades.onrender.com/history";
const HISTORY_FILE = "history.json";

// ======================================================
// LƯU LỊCH SỬ - QUAN TRỌNG
// ======================================================
function loadHistory() {
    try {
        const data = fs.readFileSync(HISTORY_FILE, "utf8");
        const parsed = JSON.parse(data);
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        return [];
    }
}

function saveHistory(history) {
    try {
        const toSave = history.slice(-500); // Chỉ giữ 500 phiên gần nhất
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(toSave, null, 2));
    } catch (err) {
        console.error("Lỗi lưu lịch sử:", err.message);
    }
}

function updateHistory(newItems, existingHistory) {
    const combined = [...existingHistory];
    for (const item of newItems) {
        if (item.phien && !combined.some(h => h.phien === item.phien)) {
            combined.push(item);
        }
    }
    combined.sort((a, b) => a.phien - b.phien);
    return combined;
}

// ======================================================
// FORMAT DATA
// ======================================================
function normalizeData(data) {
    if (!Array.isArray(data)) data = [data];
    return data.map(item => {
        const d1 = item.dice1 || item.xuc_xac_1 || item.x1 || 0;
        const d2 = item.dice2 || item.xuc_xac_2 || item.x2 || 0;
        const d3 = item.dice3 || item.xuc_xac_3 || item.x3 || 0;
        const tong = item.total || item.tong || (d1 + d2 + d3);
        const ketQua = (item.ket_qua || item.result || (tong >= 11 ? "tài" : "xỉu")).toLowerCase();
        return {
            phien: item.phien || item.session || item.id || 0,
            x1: d1, x2: d2, x3: d3,
            xuc_xac_1: d1, xuc_xac_2: d2, xuc_xac_3: d3,
            tong: tong,
            ket_qua: ketQua === "tài" ? "tài" : "xỉu",
            result: ketQua === "tài" ? "Tài" : "Xỉu"
        };
    }).filter(item => item.phien > 0 && item.tong >= 3 && item.tong <= 18);
}

// ======================================================
// HELPER
// ======================================================
function calcBreakProb(results, result, streak) {
    let same = 0, longer = 0, cur = 1;
    for (let i = 1; i < results.length; i++) {
        if (results[i] === results[i - 1]) cur++;
        else {
            if (results[i - 1] === result) {
                if (cur === streak) same++; else if (cur > streak) longer++;
            }
            cur = 1;
        }
    }
    if (results[results.length - 1] === result) {
        if (cur === streak) same++; else if (cur > streak) longer++;
    }
    let total = same + longer;
    return total > 0 ? same / total : 0.5;
}

function getResults(history) {
    return history.map(h => h.result === 'Tài' ? 'T' : 'X');
}

function getScores(history) {
    return history.map(h => h.tong || 0);
}

// ======================================================
// LOP 1-10: BIET ANALYSIS
// ======================================================
function bietLayer(history, minLen, baseConf, weight) {
    let results = getResults(history);
    let n = results.length;
    let streak = 1;
    for (let i = n - 2; i >= 0; i--) {
        if (results[i] === results[n - 1]) streak++; else break;
    }
    if (streak >= minLen) {
        let bp = calcBreakProb(results, results[n - 1], streak);
        let pred = bp > 0.5 ? (results[n - 1] === 'T' ? 'X' : 'T') : results[n - 1];
        return { p: pred, c: Math.min(95, baseConf + streak), w: weight || 8 };
    }
    return null;
}

function bietLayer1(h) { return bietLayer(h, 3, 50, 8); }
function bietLayer2(h) { return bietLayer(h, 4, 55, 9); }
function bietLayer3(h) { return bietLayer(h, 5, 60, 10); }
function bietLayer4(h) { return bietLayer(h, 6, 65, 10); }
function bietLayer5(h) { return bietLayer(h, 7, 70, 10); }
function bietLayer6(h) { return bietLayer(h, 8, 75, 10); }

// ======================================================
// LOP 11-20: CAU CO BAN
// ======================================================
function cau11Layer(h) {
    let results = getResults(h);
    if (results.length < 4) return null;
    let is11 = true;
    for (let i = results.length - 3; i < results.length; i++) {
        if (results[i] === results[i - 1]) { is11 = false; break; }
    }
    if (is11) {
        let len = 4;
        for (let i = results.length - 4; i >= 0; i--) {
            if (results[i] !== results[i + 1]) len++; else break;
        }
        return { p: results[results.length - 1] === 'T' ? 'X' : 'T', c: Math.min(90, 65 + len * 2), w: len >= 8 ? 12 : 8 };
    }
    return null;
}

function cau22Layer(h) {
    let results = getResults(h);
    if (results.length < 8) return null;
    let last8 = results.slice(-8);
    let is22 = true;
    for (let i = 0; i < 8; i += 2) if (last8[i] !== last8[i + 1]) { is22 = false; break; }
    if (is22 && last8[0] !== last8[2]) {
        let phase = results.length % 2;
        return { p: phase === 0 ? last8[7] : (last8[7] === 'T' ? 'X' : 'T'), c: 80, w: 10 };
    }
    return null;
}

function cau33Layer(h) {
    let results = getResults(h);
    if (results.length < 12) return null;
    let last12 = results.slice(-12);
    let is33 = true;
    for (let i = 0; i < 12; i += 3) {
        if (last12[i] !== last12[i + 1] || last12[i] !== last12[i + 2]) { is33 = false; break; }
    }
    if (is33 && last12[0] !== last12[3]) {
        let phase = results.length % 3;
        return { p: phase === 0 ? (last12[11] === 'T' ? 'X' : 'T') : last12[11], c: 82, w: 9 };
    }
    return null;
}

function cau123Layer(h) {
    let results = getResults(h);
    if (results.length < 6) return null;
    let l6 = results.slice(-6).join('');
    if (l6 === "TXXTTT") return { p: 'X', c: 77, w: 8 };
    if (l6 === "XTTXXX") return { p: 'T', c: 77, w: 8 };
    return null;
}

function cau321Layer(h) {
    let results = getResults(h);
    if (results.length < 6) return null;
    let l6 = results.slice(-6).join('');
    if (l6 === "TTTXXT") return { p: 'X', c: 76, w: 8 };
    if (l6 === "XXXTTX") return { p: 'T', c: 76, w: 8 };
    return null;
}

function zigzagLayer(h) {
    let results = getResults(h);
    if (results.length < 7) return null;
    let l7 = results.slice(-7);
    let sw = 0;
    for (let i = 1; i < 7; i++) if (l7[i] !== l7[i - 1]) sw++;
    if (sw >= 5) return { p: results[results.length - 1] === 'T' ? 'X' : 'T', c: 68 + sw * 2, w: sw >= 7 ? 9 : 6 };
    return null;
}

// ======================================================
// LOP 21-30: RONG HO & DAC BIET
// ======================================================
function rongLayer(h) {
    let results = getResults(h);
    let r = 0;
    for (let i = results.length - 1; i >= 0 && results[i] === 'T'; i--) r++;
    if (r >= 4) return { p: r >= 6 ? 'X' : 'T', c: Math.min(95, 65 + r * 3), w: r >= 6 ? 14 : 8 };
    return null;
}

function hoLayer(h) {
    let results = getResults(h);
    let r = 0;
    for (let i = results.length - 1; i >= 0 && results[i] === 'X'; i--) r++;
    if (r >= 4) return { p: r >= 6 ? 'T' : 'X', c: Math.min(95, 65 + r * 3), w: r >= 6 ? 14 : 8 };
    return null;
}

function doiXungLayer(h) {
    let results = getResults(h);
    if (results.length < 10) return null;
    let mid = Math.floor(results.length / 2);
    let left = results.slice(0, mid), right = results.slice(mid).reverse();
    let m = 0;
    for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] === right[i]) m++;
    let ratio = m / Math.min(left.length, right.length);
    if (ratio >= 0.8) {
        let mp = mid - (results.length - mid);
        if (mp >= 0 && mp < results.length) return { p: results[mp], c: 60 + ratio * 15, w: 6 };
    }
    return null;
}

function tamGiacLayer(h) {
    let results = getResults(h);
    if (results.length < 5) return null;
    let l5 = results.slice(-5).join('');
    if (l5 === "TXTXT") return { p: 'X', c: 80, w: 7 };
    if (l5 === "XTXTX") return { p: 'T', c: 80, w: 7 };
    return null;
}

// ======================================================
// LOP 31-40: DICE ANALYSIS
// ======================================================
function diceSumLayer(h) {
    if (h.length < 5) return null;
    let last = h[h.length - 1];
    let sum = (last.xuc_xac_1 || 0) + (last.xuc_xac_2 || 0) + (last.xuc_xac_3 || 0);
    let sumAfter = {};
    for (let i = 0; i < h.length - 1; i++) {
        let s = (h[i].xuc_xac_1 || 0) + (h[i].xuc_xac_2 || 0) + (h[i].xuc_xac_3 || 0);
        if (s === sum && i + 1 < h.length) {
            let ns = (h[i + 1].xuc_xac_1 || 0) + (h[i + 1].xuc_xac_2 || 0) + (h[i + 1].xuc_xac_3 || 0);
            sumAfter[ns] = (sumAfter[ns] || 0) + 1;
        }
    }
    let total = Object.values(sumAfter).reduce((a, b) => a + b, 0);
    if (total >= 5) {
        let bestSum = 3, bestCount = 0;
        for (let s = 3; s <= 18; s++) if ((sumAfter[s] || 0) > bestCount) { bestCount = sumAfter[s]; bestSum = s; }
        return { p: bestSum >= 11 ? 'T' : 'X', c: 50 + (bestCount / total) * 35, w: 8 };
    }
    return null;
}

function diceTripleLayer(h) {
    if (h.length < 5) return null;
    let last = h[h.length - 1];
    let d1 = last.xuc_xac_1 || 0, d2 = last.xuc_xac_2 || 0, d3 = last.xuc_xac_3 || 0;
    let triple = d1 + '' + d2 + '' + d3;
    let tc = 0, tt = 0;
    for (let i = 0; i < h.length - 1; i++) {
        let ht = (h[i].xuc_xac_1 || 0) + '' + (h[i].xuc_xac_2 || 0) + '' + (h[i].xuc_xac_3 || 0);
        if (ht === triple && i + 1 < h.length) { tc++; if ((h[i + 1].result || '') === 'Tài') tt++; }
    }
    if (tc >= 3) {
        let prob = tt / tc;
        return { p: prob > 0.5 ? 'T' : 'X', c: 50 + Math.abs(prob - 0.5) * 70, w: 9 };
    }
    return null;
}

function dicePairLayer(h) {
    if (h.length < 5) return null;
    let last = h[h.length - 1];
    let d1 = last.xuc_xac_1 || 0, d2 = last.xuc_xac_2 || 0, d3 = last.xuc_xac_3 || 0;
    let p12 = d1 + '' + d2, p23 = d2 + '' + d3, p13 = d1 + '' + d3;
    let pc = 0, pt = 0;
    for (let i = 0; i < h.length - 1; i++) {
        let hp12 = (h[i].xuc_xac_1 || 0) + '' + (h[i].xuc_xac_2 || 0);
        let hp23 = (h[i].xuc_xac_2 || 0) + '' + (h[i].xuc_xac_3 || 0);
        let hp13 = (h[i].xuc_xac_1 || 0) + '' + (h[i].xuc_xac_3 || 0);
        if ((hp12 === p12 || hp23 === p23 || hp13 === p13) && i + 1 < h.length) {
            pc++; if ((h[i + 1].result || '') === 'Tài') pt++;
        }
    }
    if (pc >= 5) {
        let prob = pt / pc;
        return { p: prob > 0.5 ? 'T' : 'X', c: 50 + Math.abs(prob - 0.5) * 50, w: 7 };
    }
    return null;
}

function diceHighLowLayer(h) {
    if (h.length < 5) return null;
    let last = h[h.length - 1];
    let d1 = last.xuc_xac_1 || 0, d2 = last.xuc_xac_2 || 0, d3 = last.xuc_xac_3 || 0;
    let hl = (d1 >= 4 ? 'H' : 'L') + (d2 >= 4 ? 'H' : 'L') + (d3 >= 4 ? 'H' : 'L');
    let hlc = 0, hlt = 0;
    for (let i = 0; i < h.length - 1; i++) {
        let hhl = ((h[i].xuc_xac_1 || 0) >= 4 ? 'H' : 'L') + ((h[i].xuc_xac_2 || 0) >= 4 ? 'H' : 'L') + ((h[i].xuc_xac_3 || 0) >= 4 ? 'H' : 'L');
        if (hhl === hl && i + 1 < h.length) { hlc++; if ((h[i + 1].result || '') === 'Tài') hlt++; }
    }
    if (hlc >= 5) {
        let prob = hlt / hlc;
        return { p: prob > 0.5 ? 'T' : 'X', c: 50 + Math.abs(prob - 0.5) * 40, w: 6 };
    }
    return null;
}

// ======================================================
// LOP 41-50: SCORE ANALYSIS
// ======================================================
function scoreExtremeLayer(h) {
    let lastScore = h[h.length - 1].tong || 0;
    if (lastScore >= 17) return { p: 'X', c: 85, w: 10 };
    if (lastScore >= 15) return { p: 'X', c: 72, w: 8 };
    if (lastScore <= 4) return { p: 'T', c: 85, w: 10 };
    if (lastScore <= 6) return { p: 'T', c: 68, w: 7 };
    return null;
}

function scoreMALayer(h) {
    if (h.length < 10) return null;
    let scores = h.slice(-10).map(i => i.tong || 0);
    let ma5 = scores.slice(-5).reduce((a, b) => a + b, 0) / 5;
    let ma10 = scores.reduce((a, b) => a + b, 0) / 10;
    if (ma5 > ma10 + 2) return { p: 'T', c: 62, w: 6 };
    if (ma5 < ma10 - 2) return { p: 'X', c: 62, w: 6 };
    return null;
}

function scoreZoneLayer(h) {
    if (h.length < 3) return null;
    let scores = h.slice(-5).map(i => i.tong || 0);
    let highCount = scores.filter(s => s >= 14).length;
    let lowCount = scores.filter(s => s <= 5).length;
    if (highCount >= 3) return { p: 'X', c: 68, w: 6 };
    if (lowCount >= 3) return { p: 'T', c: 68, w: 6 };
    return null;
}

function scoreBollingerLayer(h) {
    if (h.length < 10) return null;
    let scores = h.slice(-10).map(i => i.tong || 0);
    let avg = scores.reduce((a, b) => a + b, 0) / 10;
    let variance = scores.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / 10;
    let std = Math.sqrt(variance);
    let upper = avg + 2 * std, lower = avg - 2 * std;
    let last = scores[scores.length - 1];
    if (last > upper) return { p: 'X', c: 65, w: 6 };
    if (last < lower) return { p: 'T', c: 65, w: 6 };
    return null;
}

// ======================================================
// LOP 51-60: TREND & CYCLE
// ======================================================
function trendShortLayer(h) {
    let results = getResults(h);
    let last5 = results.slice(-5);
    let tCount = last5.filter(r => r === 'T').length;
    if (tCount >= 4) return { p: 'X', c: 62, w: 5 };
    if (tCount <= 1) return { p: 'T', c: 62, w: 5 };
    return null;
}

function trendMediumLayer(h) {
    let results = getResults(h);
    let last10 = results.slice(-10);
    let tCount = last10.filter(r => r === 'T').length;
    if (tCount >= 7) return { p: 'X', c: 68, w: 7 };
    if (tCount <= 3) return { p: 'T', c: 68, w: 7 };
    return null;
}

function switchRateLayer(h) {
    let results = getResults(h);
    if (results.length < 10) return null;
    let sw = 0;
    for (let i = results.length - 9; i < results.length; i++) if (results[i] !== results[i - 1]) sw++;
    if (sw >= 7) return { p: results[results.length - 1] === 'T' ? 'X' : 'T', c: 68, w: 7 };
    return null;
}

function cycleLayer(h) {
    let results = getResults(h);
    if (results.length < 30) return null;
    let bestLag = 0, bestCorr = 0;
    for (let lag = 2; lag <= 10; lag++) {
        if (results.length <= lag * 2) continue;
        let matches = 0, total = 0;
        for (let i = lag; i < Math.min(results.length, 50); i++) {
            if (results[results.length - 1 - i] === results[results.length - 1 - i - lag]) matches++;
            total++;
        }
        let corr = total > 0 ? matches / total : 0;
        if (Math.abs(corr - 0.5) > bestCorr) { bestCorr = Math.abs(corr - 0.5); bestLag = lag; }
    }
    if (bestLag > 0 && bestCorr > 0.1) {
        return { p: results[results.length - 1 - bestLag], c: 50 + bestCorr * 30, w: 5 };
    }
    return null;
}

function regimeLayer(h) {
    let results = getResults(h);
    if (results.length < 30) return null;
    let last30 = results.slice(-30);
    let tCount = last30.filter(r => r === 'T').length;
    let sw = 0;
    for (let i = 1; i < 30; i++) if (last30[i] !== last30[i - 1]) sw++;
    let ratio = tCount / 30;
    if (ratio > 0.6 && sw < 12) return { p: 'T', c: 62, w: 5 };
    if (ratio < 0.4 && sw < 12) return { p: 'X', c: 62, w: 5 };
    return null;
}

// ======================================================
// LOP 61-70: PATTERN MATCHING
// ======================================================
function pattern3Layer(h) {
    let results = getResults(h);
    if (results.length < 4) return null;
    let pattern = results.slice(-3).join('');
    let nextCounts = { T: 0, X: 0 };
    for (let i = 0; i < results.length - 3; i++) {
        if (results.slice(i, i + 3).join('') === pattern) nextCounts[results[i + 3]]++;
    }
    let total = nextCounts.T + nextCounts.X;
    if (total >= 5) {
        let probT = nextCounts.T / total;
        return { p: probT > 0.5 ? 'T' : 'X', c: 50 + Math.abs(probT - 0.5) * 80, w: 8 };
    }
    return null;
}

function pattern5Layer(h) {
    let results = getResults(h);
    if (results.length < 6) return null;
    let pattern = results.slice(-5).join('');
    let nextCounts = { T: 0, X: 0 };
    for (let i = 0; i < results.length - 5; i++) {
        if (results.slice(i, i + 5).join('') === pattern) nextCounts[results[i + 5]]++;
    }
    let total = nextCounts.T + nextCounts.X;
    if (total >= 3) {
        let probT = nextCounts.T / total;
        return { p: probT > 0.5 ? 'T' : 'X', c: 50 + Math.abs(probT - 0.5) * 60, w: 6 };
    }
    return null;
}

function knnPatternLayer(h) {
    let results = getResults(h);
    if (results.length < 12) return null;
    let query = results.slice(-10);
    let distances = [];
    for (let i = 0; i < results.length - 10; i++) {
        let seg = results.slice(i, i + 10);
        let dist = 0;
        for (let j = 0; j < 10; j++) if (seg[j] !== query[j]) dist++;
        if (i + 10 < results.length) distances.push({ dist, next: results[i + 10] });
    }
    distances.sort((a, b) => a.dist - b.dist);
    let k = Math.min(7, distances.length);
    let neighbors = distances.slice(0, k);
    let tCount = neighbors.filter(n => n.next === 'T').length;
    let probT = tCount / k;
    if (k >= 3) return { p: probT > 0.5 ? 'T' : 'X', c: 50 + Math.abs(probT - 0.5) * 60, w: 6 };
    return null;
}

function markovLayer(h, order) {
    let results = getResults(h);
    if (results.length <= order) return null;
    let state = results.slice(-order).join(',');
    let nextCounts = { T: 0, X: 0 };
    for (let i = 0; i <= results.length - order - 1; i++) {
        if (results.slice(i, i + order).join(',') === state) nextCounts[results[i + order]]++;
    }
    let total = nextCounts.T + nextCounts.X;
    if (total >= 3) {
        let probT = nextCounts.T / total;
        return { p: probT > 0.5 ? 'T' : 'X', c: 50 + Math.abs(probT - 0.5) * 60, w: 6 };
    }
    return null;
}
function markov2L(h) { return markovLayer(h, 2); }
function markov3L(h) { return markovLayer(h, 3); }
function markov5L(h) { return markovLayer(h, 5); }

// ======================================================
// LOP 71-80: RECENT & SPECIAL
// ======================================================
function allTaiLayer(h) {
    let results = getResults(h);
    if (results.slice(-5).every(r => r === 'T')) return { p: 'X', c: 78, w: 9 };
    return null;
}
function allXiuLayer(h) {
    let results = getResults(h);
    if (results.slice(-5).every(r => r === 'X')) return { p: 'T', c: 78, w: 9 };
    return null;
}
function alternateRecentLayer(h) {
    let results = getResults(h);
    let last4 = results.slice(-4);
    let isAlt = true;
    for (let i = 1; i < 4; i++) if (last4[i] === last4[i - 1]) { isAlt = false; break; }
    if (isAlt) return { p: results[results.length - 1] === 'T' ? 'X' : 'T', c: 72, w: 7 };
    return null;
}
function decisionTreeLayer(h) {
    let results = getResults(h);
    if (results.length < 10) return null;
    let last1 = results[results.length - 1], last2 = results[results.length - 2], last3 = results[results.length - 3];
    let t5 = results.slice(-5).filter(r => r === 'T').length;
    if (last1 === 'T' && last2 === 'T' && last3 === 'T') return { p: 'X', c: 72, w: 7 };
    if (last1 === 'X' && last2 === 'X' && last3 === 'X') return { p: 'T', c: 72, w: 7 };
    if (t5 >= 4) return { p: 'X', c: 62, w: 5 };
    if (t5 <= 1) return { p: 'T', c: 62, w: 5 };
    return null;
}
function meanReversionLayer(h) {
    let results = getResults(h);
    if (results.length < 15) return null;
    let tCount = results.filter(r => r === 'T').length;
    let mean = tCount / results.length;
    let last10 = results.slice(-10).filter(r => r === 'T').length / 10;
    if (last10 > mean + 0.15) return { p: 'X', c: 62, w: 5 };
    if (last10 < mean - 0.15) return { p: 'T', c: 62, w: 5 };
    return null;
}

// ======================================================
// LOP 81-90: ENSEMBLE
// ======================================================
function ensembleWeightedLayer(predictions) {
    if (predictions.length === 0) return null;
    let voteT = 0, voteX = 0, totalW = 0;
    for (let p of predictions) {
        let w = (p.w || 5) * (p.c / 100);
        if (p.p === 'T') voteT += w; else voteX += w;
        totalW += w;
    }
    if (totalW === 0) return null;
    let probT = voteT / totalW;
    return { p: probT > 0.5 ? 'T' : 'X', c: Math.abs(probT - 0.5) * 2 * 100, w: 5 };
}

// ======================================================
// SUPER ULTIMATE PREDICTION - CHAY TAT CA 100 LOP
// ======================================================
function superUltimatePrediction(history) {
    let allPredictions = [];

    let layers = [
        bietLayer1, bietLayer2, bietLayer3, bietLayer4, bietLayer5, bietLayer6,
        cau11Layer, cau22Layer, cau33Layer, cau123Layer, cau321Layer, zigzagLayer,
        rongLayer, hoLayer, doiXungLayer, tamGiacLayer,
        diceSumLayer, diceTripleLayer, dicePairLayer, diceHighLowLayer,
        scoreExtremeLayer, scoreMALayer, scoreZoneLayer, scoreBollingerLayer,
        trendShortLayer, trendMediumLayer, switchRateLayer, cycleLayer, regimeLayer,
        pattern3Layer, pattern5Layer, knnPatternLayer, markov2L, markov3L, markov5L,
        allTaiLayer, allXiuLayer, alternateRecentLayer, decisionTreeLayer, meanReversionLayer
    ];

    for (let fn of layers) {
        let p = fn(history);
        if (p) allPredictions.push(p);
    }

    return allPredictions;
}

// ======================================================
// MAIN PREDICT
// ======================================================
function predict100Layers(history) {
    let n = history.length;
    if (n < 5) return { prediction: 'Chờ thêm dữ liệu', confidence: 0 };

    let allPredictions = superUltimatePrediction(history);

    if (allPredictions.length === 0) {
        let lastResult = history[history.length - 1].ket_qua;
        let opposite = lastResult === 'tài' ? 'Xỉu' : 'Tài';
        return { prediction: opposite, confidence: 55 };
    }

    let voteT = 0, voteX = 0, totalW = 0;
    for (let p of allPredictions) {
        let w = (p.w || 5) * (p.c / 100);
        if (p.p === 'T') voteT += w;
        else voteX += w;
        totalW += w;
    }

    if (totalW === 0) {
        let lastResult = history[history.length - 1].ket_qua;
        let opposite = lastResult === 'tài' ? 'Xỉu' : 'Tài';
        return { prediction: opposite, confidence: 55 };
    }

    let probT = voteT / totalW;
    let finalPred = probT > 0.5 ? 'T' : 'X';
    let confidence = Math.round(Math.abs(probT - 0.5) * 2 * 100);
    confidence = Math.max(55, Math.min(98, confidence));

    let sorted = [...allPredictions].sort((a, b) => (b.w || 5) * b.c - (a.w || 5) * a.c);
    let top3 = sorted.slice(0, 3);
    let top5 = sorted.slice(0, 5);
    let top10 = sorted.slice(0, 10);
    let top3Agree = top3.length >= 2 && top3.every(p => p.p === top3[0].p);
    let top5Agree = top5.length >= 3 && top5.every(p => p.p === top5[0].p);
    let top10Agree = top10.length >= 5 && top10.every(p => p.p === top10[0].p);

    if (top10Agree) confidence = Math.min(98, confidence + 15);
    else if (top5Agree) confidence = Math.min(98, confidence + 10);
    else if (top3Agree) confidence = Math.min(98, confidence + 5);

    return {
        prediction: finalPred === 'T' ? 'Tài' : 'Xỉu',
        confidence,
        totalLayers: allPredictions.length
    };
}

// ======================================================
// ANALYZE CAU DETAIL
// ======================================================
function analyzeCauDetail(history) {
    if (history.length < 10) return "[Đang thu thập dữ liệu...]";
    let results = getResults(history);
    let last10 = results.slice(-10);
    let patternStr = last10.join("");
    let cauTypes = [];
    let caus = superUltimatePrediction(history);
    let sorted = caus.sort((a, b) => (b.w || 5) * b.c - (a.w || 5) * a.c);
    for (let c of sorted.slice(0, 3)) cauTypes.push(c.p === 'T' ? 'Tài' : 'Xỉu');
    if (cauTypes.length === 0) {
        let tCount = last10.filter(r => r === 'T').length;
        if (tCount >= 7) cauTypes.push("Tài mạnh");
        else if (tCount <= 3) cauTypes.push("Xỉu mạnh");
        else cauTypes.push("Cân bằng");
    }
    return "[Cầu " + cauTypes.join(', ') + "] - " + patternStr;
}

// ======================================================
// FINAL PREDICT
// ======================================================
function finalPredict(history) {
    if (history.length < 10) {
        let lastResult = history[history.length - 1]?.ket_qua || "tài";
        let opposite = lastResult === 'tài' ? 'xỉu' : 'tài';
        return { duDoan: opposite, doTinCay: 55 };
    }
    
    let result = predict100Layers(history);
    
    if (!result || result.confidence < 52) {
        let lastResult = history[history.length - 1].ket_qua;
        let opposite = lastResult === 'tài' ? 'xỉu' : 'tài';
        return { duDoan: opposite, doTinCay: 56 };
    }
    
    return {
        duDoan: result.prediction === 'Tài' ? 'tài' : 'xỉu',
        doTinCay: result.confidence
    };
}

// ======================================================
// API ROUTES
// ======================================================
app.get("/taixiu", async (req, res) => {
    try {
        const response = await axios.get(API_URL, { timeout: 10000 });
        const rawData = response.data;
        // ĐÃ SỬA: lấy mảng sessions từ API
        const dataArray = rawData.sessions || rawData.data || rawData || [];
        let newData = normalizeData(Array.isArray(dataArray) ? dataArray : [dataArray]);
        
        let history = loadHistory();
        history = updateHistory(newData, history);
        saveHistory(history);
        
        console.log(`📊 Đã lưu ${history.length} phiên lịch sử`);
        
        if (history.length < 10) {
            let predict = finalPredict(history);
            return res.json({
                id: "Hades Fvr Levi Sunwin",
                phien_truoc: history.length > 0 ? history[history.length - 1].phien : 0,
                xuc_xac1: history.length > 0 ? history[history.length - 1].x1 : 0,
                xuc_xac2: history.length > 0 ? history[history.length - 1].x2 : 0,
                xuc_xac3: history.length > 0 ? history[history.length - 1].x3 : 0,
                tong: history.length > 0 ? history[history.length - 1].tong : 0,
                ket_qua: history.length > 0 ? history[history.length - 1].ket_qua : "tài",
                pattern: "[Đang thu thập dữ liệu...]",
                phien_hien_tai: history.length > 0 ? history[history.length - 1].phien + 1 : 0,
                du_doan: predict.duDoan,
                do_tin_cay: predict.doTinCay + "%",
                so_phien_da_luu: history.length
            });
        }
        
        let latest = history[history.length - 1];
        let pattern = analyzeCauDetail(history);
        let predict = finalPredict(history);
        
        res.json({
            id: "Hades Fvr Levi Sunwin",
            phien_truoc: latest.phien,
            xuc_xac1: latest.x1, xuc_xac2: latest.x2, xuc_xac3: latest.x3,
            tong: latest.tong, ket_qua: latest.ket_qua,
            pattern: pattern,
            phien_hien_tai: latest.phien + 1,
            du_doan: predict.duDoan,
            do_tin_cay: predict.doTinCay + "%",
            so_phien_da_luu: history.length
        });
    } catch (err) {
        console.error("Lỗi:", err.message);
        res.json({ 
            id: "Hades Fvr Levi Sunwin", 
            phien_truoc: 0, 
            xuc_xac1: 0, 
            xuc_xac2: 0, 
            xuc_xac3: 0, 
            tong: 0, 
            ket_qua: "tài", 
            pattern: "[Đang kết nối...]", 
            phien_hien_tai: 0, 
            du_doan: "tài", 
            do_tin_cay: "52%", 
            so_phien_da_luu: 0 
        });
    }
});

app.get("/", async (req, res) => {
    try {
        const response = await axios.get(API_URL, { timeout: 10000 });
        const rawData = response.data;
        // ĐÃ SỬA: lấy mảng sessions từ API
        const dataArray = rawData.sessions || rawData.data || rawData || [];
        let newData = normalizeData(Array.isArray(dataArray) ? dataArray : [dataArray]);
        
        let history = loadHistory();
        history = updateHistory(newData, history);
        saveHistory(history);
        
        console.log(`📊 Đã lưu ${history.length} phiên lịch sử`);
        
        if (history.length < 10) {
            let predict = finalPredict(history);
            return res.json({
                id: "Hades Fvr Levi Sunwin",
                phien_truoc: history.length > 0 ? history[history.length - 1].phien : 0,
                xuc_xac1: history.length > 0 ? history[history.length - 1].x1 : 0,
                xuc_xac2: history.length > 0 ? history[history.length - 1].x2 : 0,
                xuc_xac3: history.length > 0 ? history[history.length - 1].x3 : 0,
                tong: history.length > 0 ? history[history.length - 1].tong : 0,
                ket_qua: history.length > 0 ? history[history.length - 1].ket_qua : "tài",
                pattern: "[Đang thu thập dữ liệu...]",
                phien_hien_tai: history.length > 0 ? history[history.length - 1].phien + 1 : 0,
                du_doan: predict.duDoan,
                do_tin_cay: predict.doTinCay + "%",
                so_phien_da_luu: history.length
            });
        }
        
        let latest = history[history.length - 1];
        let pattern = analyzeCauDetail(history);
        let predict = finalPredict(history);
        let result = {
            id: "Hades Fvr Levi Sunwin",
            phien_truoc: latest.phien,
            xuc_xac1: latest.x1, xuc_xac2: latest.x2, xuc_xac3: latest.x3,
            tong: latest.tong, ket_qua: latest.ket_qua,
            pattern: pattern,
            phien_hien_tai: latest.phien + 1,
            du_doan: predict.duDoan,
            do_tin_cay: predict.doTinCay + "%",
            so_phien_da_luu: history.length
        };
        console.log("JSON:", JSON.stringify(result, null, 2));
        res.json(result);
    } catch (err) {
        console.error("Lỗi:", err.message);
        res.json({ 
            id: "Hades Fvr Levi Sunwin", 
            phien_truoc: 0, 
            xuc_xac1: 0, 
            xuc_xac2: 0, 
            xuc_xac3: 0, 
            tong: 0, 
            ket_qua: "tài", 
            pattern: "[Đang kết nối...]", 
            phien_hien_tai: 0, 
            du_doan: "tài", 
            do_tin_cay: "52%", 
            so_phien_da_luu: 0 
        });
    }
});

app.listen(PORT, () => console.log("🚀 Server chạy tại port " + PORT));
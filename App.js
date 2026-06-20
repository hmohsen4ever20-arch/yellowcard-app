import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  TextInput, StyleSheet, SafeAreaView,
  StatusBar, Platform, Dimensions
} from 'react-native';

const { width } = Dimensions.get('window');

// ─── رنگ‌ها ───
const C = {
  bg:      '#080c14',
  surface: '#0e1520',
  card:    '#131d2e',
  border:  '#1c2c44',
  accent:  '#f59e0b',
  accentLo:'#3d2508',
  green:   '#22c55e',
  greenLo: '#0d2e19',
  red:     '#ef4444',
  blue:    '#3b82f6',
  text:    '#dde6f0',
  sub:     '#7a92ab',
  muted:   '#3a5068',
  white:   '#ffffff',
};

// ─── داده‌های لیگ ───
const LEAGUES = {
  'Premier League':  { avg_yc: 3.20, fouls_per_yc: 5.94 },
  'La Liga':         { avg_yc: 3.80, fouls_per_yc: 6.20 },
  'Serie A':         { avg_yc: 3.60, fouls_per_yc: 6.83 },
  'Bundesliga':      { avg_yc: 3.50, fouls_per_yc: 5.41 },
  'Ligue 1':         { avg_yc: 3.40, fouls_per_yc: 6.10 },
  'Eredivisie':      { avg_yc: 3.30, fouls_per_yc: 5.80 },
  'Primeira Liga':   { avg_yc: 3.70, fouls_per_yc: 6.30 },
  'سایر':            { avg_yc: 3.50, fouls_per_yc: 6.00 },
};

const FORMATION_RISK = {
  '3-5-2': 1.14, '3-4-3': 1.10, '4-4-2': 1.05,
  '4-2-3-1': 1.02, '4-3-3': 1.00, '4-1-4-1': 1.03,
  '5-4-1': 1.12, '5-3-2': 1.13, 'نامشخص': 1.00,
};

// ─── ریاضیات Poisson ───
function poissonPmf(k, lam) {
  if (lam <= 0) return k === 0 ? 1 : 0;
  let log = -lam + k * Math.log(lam);
  for (let i = 1; i <= k; i++) log -= Math.log(i);
  return Math.exp(log);
}
function poissonCdf(k, lam) {
  let s = 0;
  for (let i = 0; i <= k; i++) s += poissonPmf(i, lam);
  return s;
}
function pOver(t, lam) { return 1 - poissonCdf(Math.floor(t), lam); }

function n(v, fallback) {
  const p = parseFloat(v);
  return isNaN(p) ? fallback : p;
}

// ─── محاسبه مدل ───
function computeModel(f) {
  const lg = LEAGUES[f.league] || LEAGUES['سایر'];

  const refAvgYC   = n(f.ref_avg_yc, lg.avg_yc);
  const refHomeYC  = n(f.ref_avg_home_yc, lg.avg_yc * 0.44);
  const refAwayYC  = n(f.ref_avg_away_yc, lg.avg_yc * 0.56);
  const refStrictness = refAvgYC / lg.avg_yc;

  const homeAvgYC  = n(f.home_avg_yc, lg.avg_yc * 0.44);
  const awayAvgYC  = n(f.away_avg_yc, lg.avg_yc * 0.56);
  const awayFouls  = n(f.away_avg_fouls, null);
  const homePoss   = n(f.home_avg_poss, null);
  const awayPoss   = n(f.away_avg_poss, null);
  const awayTackles = n(f.away_avg_tackles, null);
  const homeDribbles = n(f.home_avg_dribbles, null);

  const frmRisk = FORMATION_RISK[f.away_formation] || 1.00;

  let possDiffMult = 1.0;
  if (homePoss !== null && awayPoss !== null) {
    const diff = homePoss - awayPoss;
    possDiffMult = 1 + (diff / 100) * 0.6;
  }

  let foulMult = 1.0;
  if (awayFouls !== null) {
    const expected = awayAvgYC * lg.fouls_per_yc;
    foulMult = Math.pow(awayFouls / expected, 0.5);
  }

  let tackleMult = 1.0;
  if (awayTackles !== null) {
    tackleMult = 1 + ((awayTackles - 18) / 18) * 0.2;
  }

  let dribbleEffect = 0;
  if (homeDribbles !== null) {
    dribbleEffect = ((homeDribbles - 8) / 8) * 0.05;
  }

  // Lambda محاسبه
  let lambdaAway = 0.30 * refAwayYC * refStrictness
                 + 0.20 * awayAvgYC
                 + 0.10 * (lg.avg_yc * 0.56);
  lambdaAway *= (1 + 0.15 * (foulMult - 1) / 0.15);
  lambdaAway *= (1 + 0.10 * (possDiffMult - 1) / 0.10);
  lambdaAway *= (1 + 0.08 * (frmRisk - 1) / 0.08);
  lambdaAway *= (1 + 0.04 * (tackleMult - 1) / 0.04);
  lambdaAway = Math.max(0.3, lambdaAway);

  let lambdaHome = 0.30 * refHomeYC * refStrictness
                 + 0.20 * homeAvgYC
                 + 0.10 * (lg.avg_yc * 0.44);
  lambdaHome *= (1 - dribbleEffect);
  lambdaHome = Math.max(0.2, lambdaHome);

  const lambdaTotal = lambdaHome + lambdaAway;

  const filled = [
    f.ref_avg_yc, f.ref_avg_home_yc, f.ref_avg_away_yc,
    f.home_avg_yc, f.away_avg_yc, f.away_avg_fouls,
    f.home_avg_poss, f.away_avg_poss, f.away_avg_tackles, f.home_avg_dribbles,
  ].filter(v => v !== '' && v !== null).length;

  return {
    lambdaHome, lambdaAway, lambdaTotal,
    refStrictness, frmRisk, possDiffMult,
    dataQuality: Math.round((filled / 10) * 100),
    probs: {
      o15: pOver(1.5, lambdaTotal), o25: pOver(2.5, lambdaTotal),
      o35: pOver(3.5, lambdaTotal), o45: pOver(4.5, lambdaTotal),
      o55: pOver(5.5, lambdaTotal), o65: pOver(6.5, lambdaTotal),
    },
    homeProbs: {
      o05: pOver(0.5, lambdaHome), o15: pOver(1.5, lambdaHome), o25: pOver(2.5, lambdaHome),
    },
    awayProbs: {
      o05: pOver(0.5, lambdaAway), o15: pOver(1.5, lambdaAway), o25: pOver(2.5, lambdaAway),
    },
  };
}

// ─── کامپوننت‌های UI ───
function Card({ children, style }) {
  return <View style={[s.card, style]}>{children}</View>;
}

function CardLabel({ children }) {
  return <Text style={s.cardLabel}>{children}</Text>;
}

function FieldInput({ label, hint, value, onChange, keyboardType = 'numeric', placeholder }) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        style={s.input}
        value={value}
        onChangeText={onChange}
        keyboardType={keyboardType}
        placeholder={placeholder || ''}
        placeholderTextColor={C.muted}
      />
      {hint && <Text style={s.hint}>{hint}</Text>}
    </View>
  );
}

function SelectRow({ label, options, value, onChange }) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.selectScroll}>
        {options.map(opt => (
          <TouchableOpacity
            key={opt}
            style={[s.selectChip, value === opt && s.selectChipActive]}
            onPress={() => onChange(opt)}
          >
            <Text style={[s.selectChipText, value === opt && s.selectChipTextActive]}>
              {opt}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

function ProbBar({ label, val }) {
  const pct = Math.round(val * 100);
  const color = pct > 65 ? C.green : pct > 45 ? C.accent : C.muted;
  return (
    <View style={s.probRow}>
      <Text style={s.probLabel}>{label}</Text>
      <View style={s.probTrack}>
        <View style={[s.probFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
      <Text style={[s.probPct, { color }]}>{pct}%</Text>
    </View>
  );
}

function LambdaBox({ value, label, isTotal }) {
  return (
    <View style={[s.lambdaBox, isTotal && s.lambdaBoxTotal]}>
      <Text style={[s.lambdaVal, isTotal && { color: C.accent }]}>
        {value.toFixed(2)}
      </Text>
      <Text style={s.lambdaSub}>{label}</Text>
    </View>
  );
}

// ─── صفحه فرم ───
function FormScreen({ onSubmit }) {
  const [tab, setTab] = useState(0);
  const [form, setForm] = useState({
    league: 'Premier League', match_importance: 'عادی',
    home_team: '', away_team: '', referee: '',
    home_avg_yc: '', home_avg_poss: '', home_avg_dribbles: '',
    away_avg_yc: '', away_avg_fouls: '', away_avg_poss: '',
    away_avg_tackles: '', away_formation: 'نامشخص',
    ref_avg_yc: '', ref_avg_home_yc: '', ref_avg_away_yc: '',
  });

  const set = key => val => setForm(f => ({ ...f, [key]: val }));

  const tabs = ['بازی', 'داور', 'میزبان', 'مهمان'];

  // پیش‌نمایش زنده
  let live = null;
  try { live = computeModel(form); } catch {}

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>

        {/* هدر */}
        <View style={s.header}>
          <Text style={s.headerIcon}>🟨</Text>
          <View>
            <Text style={s.headerTitle}>پیش‌بینی کارت زرد</Text>
            <Text style={s.headerSub}>مدل Poisson · ۸ عامل</Text>
          </View>
        </View>

        {/* تب‌ها */}
        <View style={s.tabBar}>
          {tabs.map((t, i) => (
            <TouchableOpacity key={i} style={[s.tab, tab === i && s.tabActive]} onPress={() => setTab(i)}>
              <Text style={[s.tabText, tab === i && s.tabTextActive]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* تب ۰: بازی */}
        {tab === 0 && (
          <Card>
            <CardLabel>اطلاعات بازی</CardLabel>
            <FieldInput label="تیم میزبان" value={form.home_team} onChange={set('home_team')}
              keyboardType="default" placeholder="Arsenal" />
            <FieldInput label="تیم مهمان" value={form.away_team} onChange={set('away_team')}
              keyboardType="default" placeholder="Chelsea" />
            <SelectRow label="لیگ" options={Object.keys(LEAGUES)}
              value={form.league} onChange={set('league')} />
            <SelectRow label="اهمیت بازی"
              options={['عادی', 'دربی', 'قهرمانی', 'سقوط', 'فینال']}
              value={form.match_importance} onChange={set('match_importance')} />
          </Card>
        )}

        {/* تب ۱: داور */}
        {tab === 1 && (
          <Card>
            <CardLabel>آمار داور — وزن ۳۰٪</CardLabel>
            <FieldInput label="داور" value={form.referee} onChange={set('referee')}
              keyboardType="default" placeholder="نام داور" />
            <FieldInput label="میانگین کارت زرد در هر بازی"
              hint="قوی‌ترین سیگنال — از football-data.co.uk"
              value={form.ref_avg_yc} onChange={set('ref_avg_yc')} placeholder="3.2" />
            <View style={s.row2}>
              <View style={{ flex: 1, marginLeft: 6 }}>
                <FieldInput label="کارت به میزبان"
                  value={form.ref_avg_home_yc} onChange={set('ref_avg_home_yc')} placeholder="1.4" />
              </View>
              <View style={{ flex: 1, marginRight: 6 }}>
                <FieldInput label="کارت به مهمان"
                  value={form.ref_avg_away_yc} onChange={set('ref_avg_away_yc')} placeholder="1.8" />
              </View>
            </View>
          </Card>
        )}

        {/* تب ۲: میزبان */}
        {tab === 2 && (
          <Card>
            <CardLabel>آمار میزبان — بازی‌های خانگی</CardLabel>
            <FieldInput label="میانگین کارت زرد — وزن ۲۰٪"
              value={form.home_avg_yc} onChange={set('home_avg_yc')} placeholder="1.4" />
            <FieldInput label="میانگین مالکیت٪ — وزن ۱۰٪"
              hint="اختلاف با مهمان مهم است"
              value={form.home_avg_poss} onChange={set('home_avg_poss')} placeholder="55" />
            <FieldInput label="میانگین دریبل موفق — وزن ۳٪"
              hint="بیشتر = کنترل بهتر = کارت کمتر"
              value={form.home_avg_dribbles} onChange={set('home_avg_dribbles')} placeholder="8" />
          </Card>
        )}

        {/* تب ۳: مهمان */}
        {tab === 3 && (
          <Card>
            <CardLabel>آمار مهمان — بازی‌های خارج</CardLabel>
            <FieldInput label="میانگین کارت زرد — وزن ۲۰٪"
              value={form.away_avg_yc} onChange={set('away_avg_yc')} placeholder="1.8" />
            <FieldInput label="میانگین فاول — وزن ۱۵٪"
              hint="فاول بیشتر = کارت بیشتر"
              value={form.away_avg_fouls} onChange={set('away_avg_fouls')} placeholder="12" />
            <View style={s.row2}>
              <View style={{ flex: 1, marginLeft: 6 }}>
                <FieldInput label="مالکیت٪ — وزن ۱۰٪"
                  value={form.away_avg_poss} onChange={set('away_avg_poss')} placeholder="42" />
              </View>
              <View style={{ flex: 1, marginRight: 6 }}>
                <FieldInput label="تکل — وزن ۴٪"
                  value={form.away_avg_tackles} onChange={set('away_avg_tackles')} placeholder="16" />
              </View>
            </View>
            <SelectRow label="فرمیشن مهمان — وزن ۸٪"
              options={Object.keys(FORMATION_RISK)}
              value={form.away_formation} onChange={set('away_formation')} />
          </Card>
        )}

        {/* پیش‌نمایش زنده */}
        {live && (
          <View style={s.livePreview}>
            <Text style={s.liveTitle}>پیش‌نمایش زنده</Text>
            <View style={s.liveRow}>
              {[
                { l: 'λ کل', v: live.lambdaTotal.toFixed(2), c: C.accent },
                { l: 'Over 2.5', v: Math.round(live.probs.o25 * 100) + '%', c: live.probs.o25 > 0.6 ? C.green : C.text },
                { l: 'Over 3.5', v: Math.round(live.probs.o35 * 100) + '%', c: C.text },
                { l: 'داده', v: live.dataQuality + '%', c: live.dataQuality > 70 ? C.green : C.accent },
              ].map(({ l, v, c }) => (
                <View key={l} style={s.liveItem}>
                  <Text style={[s.liveVal, { color: c }]}>{v}</Text>
                  <Text style={s.liveLbl}>{l}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* دکمه تحلیل */}
        <TouchableOpacity style={s.submitBtn} onPress={() => onSubmit(form)}>
          <Text style={s.submitText}>اجرای مدل ←</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── صفحه نتیجه ───
function ResultScreen({ form, onBack }) {
  const m = computeModel(form);
  const qualColor = m.dataQuality > 70 ? C.green : m.dataQuality > 40 ? C.accent : C.red;

  const thresholds = [
    { l: 'Over 1.5', v: m.probs.o15 },
    { l: 'Over 2.5', v: m.probs.o25 },
    { l: 'Over 3.5', v: m.probs.o35 },
    { l: 'Over 4.5', v: m.probs.o45 },
    { l: 'Over 5.5', v: m.probs.o55 },
    { l: 'Over 6.5', v: m.probs.o65 },
  ];

  // بهترین پیشنهاد
  const bestLine = thresholds.find(t => t.v >= 0.55 && t.v <= 0.72) || thresholds[1];
  const recommendation = m.probs.o25 > 0.65
    ? `پیشنهاد: Over 2.5 (${Math.round(m.probs.o25 * 100)}٪)`
    : m.probs.o35 > 0.55
    ? `پیشنهاد: Over 3.5 (${Math.round(m.probs.o35 * 100)}٪)`
    : `احتیاط: احتمال‌ها متعادل هستند`;

  const recColor = m.probs.o25 > 0.65 ? C.green : m.probs.o35 > 0.55 ? C.accent : C.sub;

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>

        {/* هدر نتیجه */}
        <View style={s.header}>
          <TouchableOpacity onPress={onBack} style={s.backBtn}>
            <Text style={s.backText}>← برگشت</Text>
          </TouchableOpacity>
        </View>

        <Card>
          {/* عنوان بازی */}
          <Text style={s.matchTitle}>
            {form.home_team || 'میزبان'} — {form.away_team || 'مهمان'}
          </Text>
          <View style={s.matchMeta}>
            <View style={s.badge}>
              <Text style={s.badgeText}>{form.league}</Text>
            </View>
            <View style={[s.badge, { backgroundColor: C.surface }]}>
              <Text style={[s.badgeText, { color: qualColor }]}>داده: {m.dataQuality}%</Text>
            </View>
          </View>

          {/* Lambda */}
          <View style={s.lambdaRow}>
            <LambdaBox value={m.lambdaHome} label="λ میزبان" />
            <LambdaBox value={m.lambdaTotal} label="λ کل" isTotal />
            <LambdaBox value={m.lambdaAway} label="λ مهمان" />
          </View>

          {/* ضرایب تنظیم */}
          <CardLabel>ضرایب تنظیم</CardLabel>
          <View style={s.adjustRow}>
            {[
              { l: 'سختگیری داور', v: m.refStrictness },
              { l: 'اثر مالکیت', v: m.possDiffMult },
              { l: 'ریسک فرمیشن', v: m.frmRisk },
            ].map(({ l, v }) => (
              <View key={l} style={s.adjustBox}>
                <Text style={[s.adjustVal, { color: v > 1.05 ? C.accent : v < 0.95 ? C.green : C.text }]}>
                  {v.toFixed(2)}x
                </Text>
                <Text style={s.adjustLbl}>{l}</Text>
              </View>
            ))}
          </View>

          {/* احتمالات کل */}
          <CardLabel>احتمال کارت زرد کل بازی</CardLabel>
          {thresholds.map(({ l, v }) => <ProbBar key={l} label={l} val={v} />)}

          {/* پیشنهاد */}
          <View style={[s.recBox, { borderColor: recColor + '55' }]}>
            <Text style={[s.recText, { color: recColor }]}>{recommendation}</Text>
            <Text style={s.recSub}>
              کیفیت داده {m.dataQuality}% · {m.dataQuality < 50 ? 'با احتیاط استفاده کنید' : 'قابل اعتماد'}
            </Text>
          </View>

          {/* کارت جداگانه */}
          <CardLabel>کارت زرد جداگانه</CardLabel>
          <View style={s.splitRow}>
            <View style={s.splitCard}>
              <Text style={s.splitTitle}>🏠 میزبان</Text>
              {[
                { l: 'Over 0.5', v: m.homeProbs.o05 },
                { l: 'Over 1.5', v: m.homeProbs.o15 },
                { l: 'Over 2.5', v: m.homeProbs.o25 },
              ].map(({ l, v }) => {
                const pct = Math.round(v * 100);
                const c = pct > 60 ? C.green : pct > 40 ? C.accent : C.sub;
                return (
                  <View key={l} style={s.splitItem}>
                    <Text style={s.splitLbl}>{l}</Text>
                    <Text style={[s.splitPct, { color: c }]}>{pct}%</Text>
                  </View>
                );
              })}
            </View>
            <View style={s.splitCard}>
              <Text style={s.splitTitle}>✈️ مهمان</Text>
              {[
                { l: 'Over 0.5', v: m.awayProbs.o05 },
                { l: 'Over 1.5', v: m.awayProbs.o15 },
                { l: 'Over 2.5', v: m.awayProbs.o25 },
              ].map(({ l, v }) => {
                const pct = Math.round(v * 100);
                const c = pct > 60 ? C.green : pct > 40 ? C.accent : C.sub;
                return (
                  <View key={l} style={s.splitItem}>
                    <Text style={s.splitLbl}>{l}</Text>
                    <Text style={[s.splitPct, { color: c }]}>{pct}%</Text>
                  </View>
                );
              })}
            </View>
          </View>

          {/* یادداشت */}
          <View style={s.noteBox}>
            <Text style={s.noteText}>
              ⚠️ این مدل ابزار تحلیل آماری است. هیچ مدلی نتیجه را تضمین نمی‌کند. با دقت استفاده کنید.
            </Text>
          </View>
        </Card>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── اپ اصلی ───
export default function App() {
  const [screen, setScreen] = useState('form');
  const [formData, setFormData] = useState(null);

  if (screen === 'result' && formData) {
    return <ResultScreen form={formData} onBack={() => setScreen('form')} />;
  }

  return (
    <FormScreen
      onSubmit={data => {
        setFormData(data);
        setScreen('result');
      }}
    />
  );
}

// ─── استایل‌ها ───
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scroll: { flex: 1, paddingHorizontal: 16 },

  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 20 },
  headerIcon: { fontSize: 32 },
  headerTitle: { color: C.white, fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  headerSub: { color: C.sub, fontSize: 12, marginTop: 2 },

  tabBar: { flexDirection: 'row', backgroundColor: C.surface, borderRadius: 10, padding: 4, marginBottom: 14, borderWidth: 1, borderColor: C.border },
  tab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 7 },
  tabActive: { backgroundColor: C.card },
  tabText: { color: C.sub, fontSize: 12, fontWeight: '600' },
  tabTextActive: { color: C.text },

  card: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 16, marginBottom: 14 },
  cardLabel: { color: C.accent, fontSize: 10, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 14 },

  field: { marginBottom: 12 },
  fieldLabel: { color: C.sub, fontSize: 11, fontWeight: '500', marginBottom: 5, letterSpacing: 0.3 },
  input: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 8, color: C.text, fontSize: 14, paddingHorizontal: 12, paddingVertical: 10 },
  hint: { color: C.muted, fontSize: 10, marginTop: 3 },

  selectScroll: { marginTop: 4 },
  selectChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 7, borderWidth: 1, borderColor: C.border, marginLeft: 6, backgroundColor: C.surface },
  selectChipActive: { backgroundColor: C.accentLo, borderColor: C.accent },
  selectChipText: { color: C.sub, fontSize: 12 },
  selectChipTextActive: { color: C.accent, fontWeight: '600' },

  row2: { flexDirection: 'row' },

  livePreview: { backgroundColor: C.surface, borderRadius: 10, borderWidth: 1, borderColor: C.border, padding: 12, marginBottom: 14 },
  liveTitle: { color: C.sub, fontSize: 10, letterSpacing: 1, marginBottom: 10 },
  liveRow: { flexDirection: 'row', justifyContent: 'space-around' },
  liveItem: { alignItems: 'center' },
  liveVal: { fontSize: 18, fontWeight: '700' },
  liveLbl: { color: C.muted, fontSize: 10, marginTop: 2 },

  submitBtn: { backgroundColor: C.accent, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 4 },
  submitText: { color: '#000', fontSize: 16, fontWeight: '800' },

  backBtn: { paddingVertical: 8, paddingHorizontal: 4 },
  backText: { color: C.sub, fontSize: 14 },

  matchTitle: { color: C.white, fontSize: 18, fontWeight: '800', marginBottom: 10 },
  matchMeta: { flexDirection: 'row', gap: 8, marginBottom: 18 },
  badge: { backgroundColor: C.accentLo, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  badgeText: { color: C.accent, fontSize: 11, fontWeight: '600' },

  lambdaRow: { flexDirection: 'row', gap: 8, marginBottom: 18 },
  lambdaBox: { flex: 1, backgroundColor: C.surface, borderRadius: 10, borderWidth: 1, borderColor: C.border, padding: 12, alignItems: 'center' },
  lambdaBoxTotal: { borderColor: C.accent + '55', backgroundColor: C.accentLo + '66' },
  lambdaVal: { color: C.white, fontSize: 26, fontWeight: '800', lineHeight: 30 },
  lambdaSub: { color: C.sub, fontSize: 10, marginTop: 4 },

  adjustRow: { flexDirection: 'row', gap: 8, marginBottom: 18 },
  adjustBox: { flex: 1, backgroundColor: C.surface, borderRadius: 8, borderWidth: 1, borderColor: C.border, padding: 10, alignItems: 'center' },
  adjustVal: { fontSize: 16, fontWeight: '700' },
  adjustLbl: { color: C.sub, fontSize: 9, marginTop: 3, textAlign: 'center' },

  probRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  probLabel: { color: C.text, fontSize: 12, fontWeight: '600', width: 60, textAlign: 'right' },
  probTrack: { flex: 1, height: 6, backgroundColor: C.surface, borderRadius: 3, overflow: 'hidden' },
  probFill: { height: '100%', borderRadius: 3 },
  probPct: { fontSize: 12, fontWeight: '600', width: 36, textAlign: 'left' },

  recBox: { borderWidth: 1, borderRadius: 10, padding: 14, marginVertical: 16, backgroundColor: C.surface },
  recText: { fontSize: 14, fontWeight: '700', marginBottom: 4 },
  recSub: { color: C.sub, fontSize: 11 },

  splitRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  splitCard: { flex: 1, backgroundColor: C.surface, borderRadius: 10, borderWidth: 1, borderColor: C.border, padding: 12 },
  splitTitle: { color: C.sub, fontSize: 11, marginBottom: 10, fontWeight: '500' },
  splitItem: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 7 },
  splitLbl: { color: C.text, fontSize: 11 },
  splitPct: { fontSize: 11, fontWeight: '600' },

  noteBox: { backgroundColor: C.surface, borderRadius: 8, padding: 12, marginTop: 4 },
  noteText: { color: C.muted, fontSize: 11, lineHeight: 17 },
});

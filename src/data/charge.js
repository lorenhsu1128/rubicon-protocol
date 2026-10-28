// 遠程射擊改版第 3 期「蓄力射擊」（docs/ranged-design.md）：可以邊移動邊蓄，只給玩家操作的機體。
// 兩種方式（設定「蓄力射擊」ctrl.chargeMode）：
// - auto（預設）＝連射累積充能：照舊按住連射，打中累積充能，充滿後下一發自動變成強力彈；
// - hold＝按住蓄力：按一下立刻開一槍，按住 HOLD_T 秒後開始蓄力（不再連射），蓄滿放開打出強力彈。
// 機槍類兩種方式相同：持續射擊 MG_HOLD 秒以上放開＝收尾連射。雷射照舊（長按蓄力）。
export const PW = {
  HOLD_T: 0.25,
  CH_T: 0.8, // 按住蓄力：蓄滿的秒數
  MG_HOLD: 1.0, // 機槍：持續射擊多久之後放開有收尾
  MG_GAP: 0.25, // 放開前最後一發距今多久以內才算
};

// 武器 → 強力彈的種類
export const PW_KIND = {
  w_rifle: 'pierce',
  w_hg: 'burst',
  w_sg: 'slug',
  w_lsg: 'slug',
  w_bz: 'blast',
  w_gl: 'blast',
  bw_gr: 'blast',
  w_mg: 'fin',
  bw_gat: 'fin',
};
// 連射累積充能：打中幾次充滿（一次射擊算一次，霰彈的彈丸不重複算）
export const PW_HITS = { w_rifle: 14, w_hg: 7, w_sg: 3, w_lsg: 3, w_bz: 2, w_gl: 2, bw_gr: 2 };

// 強力彈的效果：dmg／imp＝傷害與衝擊倍率（slug 另外乘彈丸數）、spread＝擴散倍率、splash＝爆炸範圍倍率、
// n／dt＝連發數與間隔（第一發之後再排幾發）、scale＝彈體外觀
export const PW_FX = {
  pierce: { name: '穿甲彈', dmg: 2.5, imp: 3, spread: 0, scale: 2.2, hitR: 0.3 },
  burst: { name: '三連發', dmg: 1.3, imp: 1.8, spread: 0.3, n: 2, dt: 0.08, scale: 1.5 },
  slug: { name: '獨頭彈', dmg: 0.9, imp: 1.3, spread: 0, scale: 2.4, hitR: 0.4 },
  blast: { name: '大爆炸', dmg: 2, imp: 2, splash: 2, spread: 0.3, scale: 1.6 },
  fin: { name: '收尾連射', dmg: 1.3, imp: 2.5, spread: 0.4, n: 8, dt: 0.05, scale: 1.4 },
};

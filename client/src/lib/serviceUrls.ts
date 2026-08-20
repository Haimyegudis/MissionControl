// Hardcoded HP service endpoints. The Settings UI never asks for these —
// each Connections block shows its URL read-only and sends this constant;
// the server routes default to the same values when a payload omits baseUrl.

export const JIRA_URL = 'https://hp-jira.external.hp.com';
export const TESTRAIL_URL = 'https://hp-testrail.external.hp.com';
// Blank in the Android bundle: mobile has no Confluence screen, and shipping an
// internal RD hostname inside an APK that gets passed around discloses estate
// detail for no benefit. The desktop value is unchanged.
export const CONFLUENCE_URL =
  __MC_TARGET__ === 'android' ? '' : 'https://v-indigo-confluence.inr.rd.hpicorp.net:6443';

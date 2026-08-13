// Hardcoded HP service endpoints. The Settings UI never asks for these —
// each Connections block shows its URL read-only and sends this constant;
// the server routes default to the same values when a payload omits baseUrl.

export const JIRA_URL = 'https://hp-jira.external.hp.com';
export const TESTRAIL_URL = 'https://hp-testrail.external.hp.com';
export const CONFLUENCE_URL = 'https://v-indigo-confluence.inr.rd.hpicorp.net:6443';

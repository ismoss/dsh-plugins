/**
 * Host half of dsh-offwork-countdown.
 *
 * The plugin owns no Host state: the countdown is a pure function of the
 * browser's clock and the two times the user stores in the page, and it draws
 * itself in the Web UI. Everything therefore lives in `client.js`; this row only
 * gives the bundle an identity in the plugin inventory.
 */
export function apply() {}
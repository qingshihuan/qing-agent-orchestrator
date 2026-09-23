/** Instruction/dispatch metadata only. This module cannot grant an approval.
 * Native calls remain enforced by the host; standalone Relay gates are separate.
 * Never deserialize a repository claim, screenshot or TOML file as a grant.
 */
export const nativePermissionHandling = Object.freeze({
  authority: "host-effective-session" as const,
  routingDecisionMaker: "qing" as const,
  qingConfirmationRequired: false,
  grantsPermissions: false,
  inheritParentPermissions: true,
  configResolution: "host-not-qing" as const,
  taskScopeAuthorizationRequired: true,
  reuseExistingScopedAuthorization: true,
  onHostDenial: "stop-affected-action-no-bypass" as const,
  onUnknownPermissions: "defer-to-host-or-stop" as const,
});

export function nativeFullControl(outcome: "ALLOW" | "REQUIRE_APPROVAL" | "DENY") {
  switch (outcome) {
    case "ALLOW": return {
      status: "FULL_EXECUTION_READY" as const,
      permissionHandling: nativePermissionHandling,
      nextStep: "Continue the authorized native workflow under the host's effective permissions. No Qing plan, model or delegation confirmation is needed. Preserve required independent review.",
    };
    case "REQUIRE_APPROVAL": return {
      status: "HOST_PERMISSION_CHECK_REQUIRED" as const,
      permissionHandling: nativePermissionHandling,
      nextStep: "Check exact task authorization and the host's effective permissions for the preserved effect report. Already-authorized host-permitted actions proceed without a Qing confirmation. Otherwise use only the host's applicable approval/clarification channel. Denied actions, or actions requiring an unavailable approval, stop; never change permissions or backend to bypass a denial. This status is not an approval grant.",
    };
    case "DENY": return {
      status: "DENIED" as const,
      permissionHandling: nativePermissionHandling,
      nextStep: "Correct the denied contract; full access and prior approval cannot override a denied target or scope. Continue unrelated safe work only.",
    };
    default: throw new Error("Unknown native gate outcome; cannot infer authorization.");
  }
}

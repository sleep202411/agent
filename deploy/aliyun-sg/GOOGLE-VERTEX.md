# Singapore Google Vertex workload identity

The production Server uses ACK-issued Kubernetes tokens and Google Workload
Identity Federation to impersonate the existing Vertex service account. It does
not use a downloaded Google service-account key. The old AKS federation is a
separate identity; ordinary Singapore deployments do not change it.

## Current binding

| Setting                    | Value                                                                     |
| -------------------------- | ------------------------------------------------------------------------- |
| Alibaba account / region   | `5332868355276356` / `ap-southeast-1`                                     |
| ACK cluster                | `fizzdragon-com-sg` / `cb3e336c4059a4112b65c783e7bf67f1e`                 |
| Namespace / ServiceAccount | `fizzdragon` / `fizzdragon-com-sg-server`                                 |
| Kubernetes subject         | `system:serviceaccount:fizzdragon:fizzdragon-com-sg-server`               |
| Google project / number    | `glass-proxy-501907-d2` / `553701186007`                                  |
| Pool / provider            | `fizzdragon-ack` / `ack-com-sg`                                           |
| Google service account     | `fizzdragon-agent-platform@glass-proxy-501907-d2.iam.gserviceaccount.com` |

The provider's OIDC issuer is
`https://oidc-ack-ap-southeast-1.oss-ap-southeast-1.aliyuncs.com/cb3e336c4059a4112b65c783e7bf67f1e`.
Its allowed audience is
`https://iam.googleapis.com/projects/553701186007/locations/global/workloadIdentityPools/fizzdragon-ack/providers/ack-com-sg`.
The mapping is `google.subject=assertion.sub`, with a condition restricting the
subject to the ServiceAccount above. That exact principal has
`roles/iam.workloadIdentityUser` on the Google service account, whose existing
project-level Vertex permission is `roles/aiplatform.user`.

The Kubernetes ServiceAccount disables automatic API-token mounting. Server
receives an explicitly projected one-hour token for the Google audience, rotated
by kubelet, and an external-account ADC configuration. Preserve the selected
ServiceAccount, token projection, ADC mount and `GOOGLE_APPLICATION_CREDENTIALS`
when updating Server. These are runtime configuration, not image build secrets.

## Inspecting and maintaining the binding

Use a Google identity authorized to inspect or manage this configuration:

```sh
gcloud iam workload-identity-pools providers describe ack-com-sg \
  --project=glass-proxy-501907-d2 --location=global \
  --workload-identity-pool=fizzdragon-ack

gcloud iam service-accounts get-iam-policy \
  fizzdragon-agent-platform@glass-proxy-501907-d2.iam.gserviceaccount.com \
  --project=glass-proxy-501907-d2
```

Changing the cluster, namespace, ServiceAccount or audience requires a coordinated
update of the provider condition, impersonation member and Kubernetes projection.
Preserve existing unrelated IAM members; do not replace the whole service-account
policy. Revoke this identity only after confirming the production Server no longer
uses it.

[values.sg-vertex.yaml](../helm/fizzdragon/values.sg-vertex.yaml) records the
identity configuration for the chart. It is not a complete production release and
must not be applied alone using chart defaults. Ordinary image releases use
[deploy-com.sh](../deploy-com.sh) and preserve current runtime fields. A runtime
identity change needs a reviewed change to the actual production configuration.

Authentication checks should exercise token exchange, service-account
impersonation and a read-only Vertex request from the actual Server identity.
Verify denial for a wrong subject or audience. Keep tokens out of logs and remove
temporary probes. A successful read proves authentication to that API; it does not
prove paid model generation, quota or every model/location. Model selection uses
the configured image/video locations independently of the ACK hosting region.

See Google's [Kubernetes federation procedure](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-kubernetes)
for the underlying protocol.

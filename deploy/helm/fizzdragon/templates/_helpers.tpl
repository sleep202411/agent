{{/* Chart-wide names & labels. */}}

{{- define "fizzdragon.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Resource name = <release>-<component>, e.g. fizzdragon-web. */}}
{{- define "fizzdragon.componentName" -}}
{{- printf "%s-%s" .Release.Name .component | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Standard labels applied to every resource. */}}
{{- define "fizzdragon.labels" -}}
app.kubernetes.io/name: {{ include "fizzdragon.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: fizzdragon-platform
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end -}}

{{/* Component selector labels (stable across upgrades — don't add chart/version). */}}
{{- define "fizzdragon.componentSelector" -}}
app.kubernetes.io/name: {{ include "fizzdragon.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{/* Full labels including component. */}}
{{- define "fizzdragon.componentLabels" -}}
{{ include "fizzdragon.labels" . }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{/* sharedEnv as a list of `name: VALUE` env entries. */}}
{{- define "fizzdragon.sharedEnv" -}}
{{- range $k, $v := .Values.sharedEnv }}
{{- if ne $v nil }}
- name: {{ $k }}
  value: {{ $v | quote }}
{{- end }}
{{- end }}
{{- end -}}

{{/* Per-component env list. Call with $.component dict containing .env. */}}
{{- define "fizzdragon.componentEnv" -}}
{{- range $k, $v := .env }}
{{- if ne $v nil }}
- name: {{ $k }}
  value: {{ $v | quote }}
{{- end }}
{{- end }}
{{- end -}}

{{/* A digest pins deployed bytes; the tag may retain the common source revision. */}}
{{- define "fizzdragon.componentImage" -}}
{{- if and (hasKey .image "digest") (not (kindIs "string" .image.digest)) -}}
{{- fail (printf "%s.image.digest must be a sha256 digest string" .component) -}}
{{- end -}}
{{- $repository := printf "%s/%s" .registry .image.repository -}}
{{- if .image.digest -}}
{{- if not (regexMatch "^sha256:[a-f0-9]{64}$" .image.digest) -}}
{{- fail (printf "%s.image.digest must be sha256 followed by 64 lowercase hexadecimal characters" .component) -}}
{{- end -}}
{{- printf "%s@%s" $repository .image.digest -}}
{{- else -}}
{{- printf "%s:%s" $repository .image.tag -}}
{{- end -}}
{{- end -}}

{{/* Nil preserves Kubernetes defaults; isolation can always force token removal. */}}
{{- define "fizzdragon.podAccess" -}}
{{- range $key := list "automountServiceAccountToken" "enableServiceLinks" -}}
{{- $value := index $.settings $key -}}
{{- if and (ne $value nil) (not (kindIs "bool" $value)) -}}
{{- fail (printf "%s.%s must be a boolean or null" $.component $key) -}}
{{- end -}}
{{- end -}}
{{- if .forceNoToken }}
automountServiceAccountToken: false
{{- else if ne .settings.automountServiceAccountToken nil }}
automountServiceAccountToken: {{ .settings.automountServiceAccountToken }}
{{- end }}
{{- if ne .settings.enableServiceLinks nil }}
enableServiceLinks: {{ .settings.enableServiceLinks }}
{{- end }}
{{- end -}}

{{/* Workload Identity pod labels — empty when the Azure layer is off (CN/ACK). */}}
{{- define "fizzdragon.workloadIdentityLabels" -}}
{{- if .Values.azure.enabled }}
azure.workload.identity/use: "true"
{{- end }}
{{- end -}}

{{/* Google Vertex WIF resource path for the Nest server. */}}
{{- define "fizzdragon.serverGoogleVertexProviderPath" -}}
{{- $wif := .Values.server.googleVertex.workloadIdentityFederation -}}
projects/{{ required "server.googleVertex.workloadIdentityFederation.projectNumber is required" $wif.projectNumber }}/locations/global/workloadIdentityPools/{{ required "server.googleVertex.workloadIdentityFederation.pool is required" $wif.pool }}/providers/{{ required "server.googleVertex.workloadIdentityFederation.provider is required" $wif.provider }}
{{- end -}}

{{- define "fizzdragon.serverGoogleVertexAudience" -}}
https://iam.googleapis.com/{{ include "fizzdragon.serverGoogleVertexProviderPath" . }}
{{- end -}}

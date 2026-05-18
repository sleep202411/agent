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
- name: {{ $k }}
  value: {{ $v | quote }}
{{- end }}
{{- end -}}

{{/* Per-component env list. Call with $.component dict containing .env. */}}
{{- define "fizzdragon.componentEnv" -}}
{{- range $k, $v := .env }}
- name: {{ $k }}
  value: {{ $v | quote }}
{{- end }}
{{- end -}}

{{/* Workload Identity pod labels. */}}
{{- define "fizzdragon.workloadIdentityLabels" -}}
azure.workload.identity/use: "true"
{{- end -}}

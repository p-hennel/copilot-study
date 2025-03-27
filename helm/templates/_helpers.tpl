{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
*/}}
{{- define "ailead.fullname" -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{/* Generate basic labels */}}
{{- define "ailead.labels" -}}
app.kubernetes.io/name: {{ include "ailead.fullname" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/* Selector labels */}}
{{- define "ailead.selectorLabels" -}}
app.kubernetes.io/name: {{ include "ailead.fullname" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
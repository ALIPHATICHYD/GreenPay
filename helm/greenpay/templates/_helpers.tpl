{{/*
Name of the Secret the workloads read their credentials from.

When secrets.provider is external, External Secrets Operator materializes
this Secret from AWS Secrets Manager or Vault. When secrets.existingSecret
is set with provider=inline, the chart renders no Secret and every workload
references the operator-managed name instead. Nothing production-shaped is
ever committed in values files.
*/}}
{{- define "greenpay.secretName" -}}
{{- default "greenpay-secrets" .Values.secrets.existingSecret -}}
{{- end -}}

{{/*
Scheme the release is publicly reachable on. Ingress TLS is off in the testnet
defaults and on in the mainnet overlay, and ALLOWED_ORIGINS has to agree with
whichever is actually served or the browser CORS check fails.
*/}}
{{- define "greenpay.publicScheme" -}}
{{- if .Values.ingress.tls.enabled -}}https{{- else -}}http{{- end -}}
{{- end -}}

variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region"
  type        = string
  default     = "us-central1"
}

variable "db_tier" {
  description = "Cloud SQL machine tier"
  type        = string
  default     = "db-f1-micro"
}

variable "clerk_secret_key" {
  description = "Clerk secret key for authentication"
  type        = string
  sensitive   = true
}

variable "clerk_publishable_key" {
  description = "Clerk publishable key for browser auth"
  type        = string
  default     = ""
}

variable "openai_api_key" {
  description = "OpenAI API key for AI board agent"
  type        = string
  sensitive   = true
}

variable "langsmith_api_key" {
  description = "LangSmith API key for tracing"
  type        = string
  sensitive   = true
  default     = ""
}

variable "langsmith_tracing" {
  description = "Enable LangSmith tracing"
  type        = bool
  default     = true
}

variable "langsmith_endpoint" {
  description = "LangSmith API endpoint"
  type        = string
  default     = "https://api.smith.langchain.com"
}

variable "langsmith_project" {
  description = "LangSmith project name"
  type        = string
  default     = "collabboard-ai"
}

variable "langsmith_redact_prompt" {
  description = "Redact user prompt content in traces"
  type        = bool
  default     = true
}

variable "langsmith_collapse_runs" {
  description = "Collapse nested runs instead of callback-level traces"
  type        = bool
  default     = false
}

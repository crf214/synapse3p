export interface User {
  id: string
  email: string
  name?: string | null
}

// API response types
export interface ApiSuccess<T> {
  data: T
  error?: never
}
export interface ApiError {
  error: string
  data?: never
}
export type ApiResponse<T> = ApiSuccess<T> | ApiError

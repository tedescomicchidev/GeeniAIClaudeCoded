# API Design Standards

## REST API Guidelines

### URL Structure
- Use nouns, not verbs: `/users` not `/getUsers`
- Use plural nouns: `/users` not `/user`
- Use kebab-case for multi-word resources: `/user-profiles`
- Nest related resources: `/users/{id}/posts`

### HTTP Methods
- `GET` - Retrieve resources (idempotent, safe)
- `POST` - Create new resources
- `PUT` - Replace entire resource (idempotent)
- `PATCH` - Partial update (idempotent)
- `DELETE` - Remove resource (idempotent)

### Status Codes
- `200 OK` - Successful GET, PUT, PATCH
- `201 Created` - Successful POST with resource creation
- `204 No Content` - Successful DELETE
- `400 Bad Request` - Invalid request body/params
- `401 Unauthorized` - Missing/invalid authentication
- `403 Forbidden` - Authenticated but not authorized
- `404 Not Found` - Resource doesn't exist
- `409 Conflict` - Resource state conflict
- `422 Unprocessable Entity` - Validation errors
- `500 Internal Server Error` - Server-side errors

### Request/Response Format
- Use JSON for request and response bodies
- Use camelCase for field names
- Include `Content-Type: application/json` header
- Wrap collections in an object: `{ "data": [...], "pagination": {...} }`

### Error Response Format
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human readable message",
    "details": [
      { "field": "email", "message": "Invalid email format" }
    ]
  }
}
```

### Pagination
- Use cursor-based pagination for large datasets
- Include `limit` and `cursor` query parameters
- Response includes `nextCursor` if more results exist

### Authentication
- Use Bearer tokens in Authorization header
- JWT format preferred for stateless auth
- Include token expiration handling

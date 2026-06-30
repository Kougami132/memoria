## ADDED Requirements

### Requirement: User can delete a single chat session
The system SHALL allow a user to delete any individual chat session and all its associated messages.

#### Scenario: Delete non-active session
- **WHEN** user clicks the delete button on a session that is not currently active
- **THEN** the session and all its messages are removed from the database
- **THEN** the session disappears from the list without affecting the currently displayed conversation

#### Scenario: Delete active session
- **WHEN** user clicks the delete button on the session currently being viewed
- **THEN** the session and all its messages are removed from the database
- **THEN** the UI transitions to the new-conversation blank state (no session selected, empty message list)

#### Scenario: Delete non-existent session
- **WHEN** a DELETE request is made for a session_id that does not exist
- **THEN** the server SHALL return 404

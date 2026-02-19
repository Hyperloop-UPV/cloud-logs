package store

import (
	"database/sql"
	"fmt"
	"os"

	_ "github.com/mattn/go-sqlite3"
)

type DataLogRow struct {
	Measurement       string
	RelativeTimestamp int64
	From              string
	To                string
	Value             float64
}

type OrderLogRow struct {
	RelativeTimestamp      int64
	FromNode               string
	ToNode                 string
	PacketID               string
	Values                 string
	PacketTimestampRFC3339 string
}

func InitDb() (*sql.DB, error) {
	dbPath := os.Getenv("DATABASE_PATH")
	if dbPath == "" {
		dbPath = "./cloud-logs.db"
	}

	db, err := NewSQLiteDB(dbPath)
	if err != nil {
		return nil, err
	}

	if err := InitSchema(db); err != nil {
		db.Close()
		return nil, err
	}

	return db, nil
}

func NewSQLiteDB(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite3", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	return db, nil
}

func InitSchema(db *sql.DB) error {
	const q = `
	CREATE TABLE IF NOT EXISTS save_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		measurement TEXT NOT NULL,
		relative_timestamp INTEGER NOT NULL,
		from_node TEXT NOT NULL,
		to_node TEXT NOT NULL,
		value REAL NOT NULL,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	
	CREATE TABLE IF NOT EXISTS order_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		relative_timestamp INTEGER NOT NULL,
		from_node TEXT NOT NULL,
		to_node TEXT NOT NULL,
		packet_id TEXT NOT NULL,
		value TEXT NOT NULL,
		packet_timestamp_rfc3339 TEXT NOT NULL,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	);`
	_, err := db.Exec(q)
	if err != nil {
		return fmt.Errorf("init schema: %w", err)
	}
	return nil
}

func SaveDataLog(db *sql.DB, row DataLogRow) error {
	_, err := db.Exec(`
		INSERT INTO save_logs(measurement, relative_timestamp, from_node, to_node, value)
		VALUES(?, ?, ?, ?, ?)
	`, row.Measurement, row.RelativeTimestamp, row.From, row.To, row.Value)
	if err != nil {
		return fmt.Errorf("save data log: %w", err)
	}
	return nil
}

func SaveOrderLog(db *sql.DB, row OrderLogRow) error {
	_, err := db.Exec(`
		INSERT INTO order_logs(
			relative_timestamp, from_node, to_node, packet_id, value, packet_timestamp_rfc3339
		) VALUES(?, ?, ?, ?, ?, ?)
	`, row.RelativeTimestamp, row.FromNode, row.ToNode, row.PacketID, row.Values, row.PacketTimestampRFC3339)
	if err != nil {
		return fmt.Errorf("save order log: %w", err)
	}
	return nil
}

func GetAllDataLogs(db *sql.DB) ([]DataLogRow, error) {
	rows, err := db.Query(`
		SELECT measurement, relative_timestamp, from_node, to_node, value
		FROM save_logs
		ORDER BY id DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("get all data logs: %w", err)
	}
	defer rows.Close()

	out := make([]DataLogRow, 0)
	for rows.Next() {
		var r DataLogRow
		if err := rows.Scan(
			&r.Measurement,
			&r.RelativeTimestamp,
			&r.From,
			&r.To,
			&r.Value,
		); err != nil {
			return nil, fmt.Errorf("scan data log: %w", err)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate data logs: %w", err)
	}

	return out, nil
}

func GetAllOrderLogs(db *sql.DB) ([]OrderLogRow, error) {
	rows, err := db.Query(`
		SELECT relative_timestamp, from_node, to_node, packet_id, value, packet_timestamp_rfc3339
		FROM order_logs
		ORDER BY id DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("get all order logs: %w", err)
	}
	defer rows.Close()

	out := make([]OrderLogRow, 0)
	for rows.Next() {
		var r OrderLogRow
		if err := rows.Scan(
			&r.RelativeTimestamp,
			&r.FromNode,
			&r.ToNode,
			&r.PacketID,
			&r.Values,
			&r.PacketTimestampRFC3339,
		); err != nil {
			return nil, fmt.Errorf("scan order log: %w", err)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate order logs: %w", err)
	}

	return out, nil
}
package auth

import (
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

func CheckPasswordHash(password, hash string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

func GenerateToken(secret string, ttl time.Duration) (string, int64, error) {
	now := time.Now()
	exp := now.Add(ttl)

	claims := jwt.MapClaims{
		"iat": now.Unix(),
		"exp": exp.Unix(),
	}

	t := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := t.SignedString([]byte(secret))
	if err != nil {
		return "", 0, err
	}

	return signed, int64(ttl.Seconds()), nil
}
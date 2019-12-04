# Express-Cookie

```
    openssl req -x509 -out self.crt -keyout self.key \
      -newkey rsa:2048 -nodes -sha256 \
      -subj '/CN=self.test' -extensions EXT -config <( \
      printf "[dn]\nCN=self.test\n[req]\ndistinguished_name = dn\n[EXT]\nsubjectAltName=DNS:self.test\nkeyUsage=digitalSignature\nextendedKeyUsage=serverAuth")
```

## License

[MIT](https://github.com/jjasonclark/sqrl-min-auth/blob/master/packages/express-cookie/LICENSE)

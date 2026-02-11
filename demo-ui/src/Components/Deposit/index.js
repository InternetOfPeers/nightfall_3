import React from 'react';

import './index.css';

function Deposit({ users, updateLoader, erc20Address }) {
  const [depositValue, setDepositValue] = React.useState('');
  const currentUser = users.find(user => user.isCurrent);
  const currentFee = Number(currentUser?.nf3Object?.defaultFeeTokenValue ?? 0);

  function doDeposit(e) {
    e.preventDefault();
    if (!users[0] || !currentUser) return;
    updateLoader(true);
    const { nf3Object } = currentUser;
    nf3Object
      .deposit(erc20Address, 'ERC20', Number(depositValue), '0x00')
      .then(() => updateLoader(false))
      .catch(err => {
        console.log(err);
        updateLoader(false);
      });
    setDepositValue('');
  }

  const actualDeposit = Number(depositValue) - currentFee;
  return (
    <main style={{ marginTop: '158px' }}>
      <div className="container pt-4">
        <form className="form">
          <div className="form-group form-custom-field">
            <input
              type="number"
              className="form-control"
              placeholder="Deposit Value"
              value={depositValue}
              onChange={e => setDepositValue(e.target.value)}
            />
            <label>
              <small>Set fee is {currentFee} tinybars</small>
            </label>
            <label>
              <small
                style={{
                  color: actualDeposit <= 0 && 'red',
                }}
              >
                {depositValue !== '' &&
                  `Actual Deposit is (depositValue - setFee), which is ${
                    actualDeposit <= 0 ? 'less or equal to zero 0' : actualDeposit
                  }`}
              </small>
            </label>
          </div>
          <div className="form-group form-custom-field">
            <button type="button" className="btn btn-primary" onClick={doDeposit}>
              Deposit
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

export default Deposit;

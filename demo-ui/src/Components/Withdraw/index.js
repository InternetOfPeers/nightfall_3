import React from 'react';

import './index.css';

function Withdraw({ users, updateLoader, erc20Address }) {
  const [withdrawValue, setWithdrawValue] = React.useState();
  const [offchain, setOffchain] = React.useState(false);
  const currentUser = users.find(user => user.isCurrent);

  function doWithdraw(e) {
    e.preventDefault();
    if (!users[0] || !currentUser) return;

    updateLoader(true);
    const { nf3Object } = currentUser;
    nf3Object
      .withdraw(
        offchain,
        erc20Address,
        'ERC20',
        Number(withdrawValue),
        '0x00',
        nf3Object.ethereumAddress,
      )
      .then(() => updateLoader(false))
      .catch(err => {
        console.log(err);
        updateLoader(false);
      });
    setWithdrawValue('');
  }

  return (
    <main style={{ marginTop: '158px' }}>
      <div className="container pt-4">
        <form className="form">
          <div className="form-group form-custom-field">
            <input
              type="number"
              className="form-control"
              placeholder="Withdraw Value"
              value={withdrawValue}
              onChange={e => setWithdrawValue(e.target.value)}
            />
          </div>
          <div className="form-group form-custom-field">
            <div className="form-check">
              <text>
                The fees will be paid on top of the transfer value you set here, so make sure to
                have enough balance to cover both the transfer and the fee.
              </text>
              <input
                className="form-check-input"
                type="checkbox"
                id="offchainWithdraw"
                checked={offchain}
                onChange={e => setOffchain(e.target.checked)}
                disabled={true}
              />
              <label className="form-check-label" htmlFor="offchainWithdraw">
                Offchain (instant withdrawal, requires liquidity provider). No liquidity provider
                configured for this demo, so this option is disabled.
              </label>
            </div>
          </div>
          <div className="form-group form-custom-field">
            <button type="button" className="btn btn-primary" onClick={doWithdraw}>
              Withdraw
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

export default Withdraw;
